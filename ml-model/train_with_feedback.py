#!/usr/bin/env python3
"""
Automated Feedback-Enhanced Training Pipeline
=============================================
Run:  python train_with_feedback.py

Steps executed automatically:
  1. Export feedback rows from Supabase
  2. Download feedback images from Storage
  3. Clean & validate (corrupt / missing images removed)
  4. Human QA review (interactive — skip with --skip-qa)
  5. Merge original + feedback data, balance classes
  6. Train MobileNetV2 (transfer-learning + optional fine-tune)
  7. Evaluate with quality gate (macro-F1, per-class recall/precision)
  8. Convert to TFLite (float32 + int8 quantized)
  9. Version the new model
"""
import os, sys, shutil, json, argparse, hashlib, datetime, glob
from collections import Counter
from pathlib import Path

import numpy as np

# ── Resolve config ──
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline_config import *

# ---------------------------------------------------------------------------
# 1. EXPORT FEEDBACK FROM SUPABASE
# ---------------------------------------------------------------------------
def export_feedback():
    """Fetch all usable feedback rows (is_correct=False with a correct_label)."""
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("\n[1/9] Exporting feedback from Supabase …")
    rows, offset, page = [], 0, 1000
    while True:
        resp = (sb.table(FEEDBACK_TABLE)
                .select("*")
                .eq("is_correct", False)
                .not_.is_("correct_label_key", "null")
                .not_.is_("image_path", "null")
                .eq("consent_image_upload", True)
                .range(offset, offset + page - 1)
                .execute())
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page

    print(f"  → {len(rows)} usable feedback rows fetched.")
    os.makedirs(FEEDBACK_DOWNLOAD_DIR, exist_ok=True)
    meta_path = os.path.join(FEEDBACK_DOWNLOAD_DIR, "feedback_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, default=str)
    return rows


# ---------------------------------------------------------------------------
# 2. DOWNLOAD FEEDBACK IMAGES
# ---------------------------------------------------------------------------
def download_feedback_images(rows):
    """Download images from Supabase Storage into class sub-folders."""
    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("\n[2/9] Downloading feedback images …")
    downloaded, skipped = 0, 0
    for r in rows:
        label = r.get("correct_label_key")
        img_path = r.get("image_path")
        if not label or not img_path:
            skipped += 1
            continue

        dest_dir = os.path.join(FEEDBACK_DOWNLOAD_DIR, label)
        os.makedirs(dest_dir, exist_ok=True)
        dest_file = os.path.join(dest_dir, os.path.basename(img_path))

        if os.path.exists(dest_file):
            downloaded += 1
            continue

        try:
            res = sb.storage.from_(FEEDBACK_BUCKET).download(img_path)
            with open(dest_file, "wb") as f:
                f.write(res)
            downloaded += 1
        except Exception as e:
            print(f"  ⚠ Download failed: {img_path} → {e}")
            skipped += 1

    print(f"  → Downloaded: {downloaded}, Skipped: {skipped}")


# ---------------------------------------------------------------------------
# 3. CLEAN & VALIDATE
# ---------------------------------------------------------------------------
def clean_and_validate():
    """Remove corrupt / unreadable images from feedback_images/."""
    from PIL import Image

    print("\n[3/9] Cleaning & validating feedback images …")
    removed = 0
    for cls in CLASS_NAMES:
        cls_dir = os.path.join(FEEDBACK_DOWNLOAD_DIR, cls)
        if not os.path.isdir(cls_dir):
            continue
        for fname in os.listdir(cls_dir):
            fpath = os.path.join(cls_dir, fname)
            try:
                with Image.open(fpath) as img:
                    img.verify()
            except Exception:
                print(f"  ✗ Corrupt/unreadable, removing: {fpath}")
                os.remove(fpath)
                removed += 1
    print(f"  → Removed {removed} bad images.")


# ---------------------------------------------------------------------------
# 4. HUMAN QA (interactive)
# ---------------------------------------------------------------------------
def human_qa():
    """Let the operator review feedback images per class and delete bad ones."""
    print("\n[4/9] Human QA Review")
    print("  Feedback images are in:", FEEDBACK_DOWNLOAD_DIR)
    for cls in CLASS_NAMES:
        cls_dir = os.path.join(FEEDBACK_DOWNLOAD_DIR, cls)
        if not os.path.isdir(cls_dir):
            continue
        count = len(os.listdir(cls_dir))
        print(f"  {cls}: {count} images  →  {cls_dir}")

    print("\n  ▶ Please open the folders above and delete any mis-labelled images.")
    input("  Press ENTER when QA is done … ")


# ---------------------------------------------------------------------------
# 5. DATA PREPARATION
# ---------------------------------------------------------------------------
# Not: "merge_and_balance" fonksiyonu kaldırıldı. Artık veriler fiziksel olarak
# kopyalanıp birleştirilmiyor. Bunun yerine train_model fonksiyonu içerisinde 
# tf.data.Dataset.sample_from_datasets kullanılarak dinamik olarak (Stratified Sampling)
# batch'ler oluşturuluyor.


# ---------------------------------------------------------------------------
# 6. TRAIN
# ---------------------------------------------------------------------------
def train_model():
    """Train MobileNetV2 using dynamic sample weighting and stratified sampling."""
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers
    import tensorflow.keras.backend as K

    print("\n[6/9] Training model with dynamic weights …")

    # Özel Macro F1 Metriği (Epoch içi batch-by-batch hesaplama için)
    class MacroF1Metric(keras.metrics.Metric):
        def __init__(self, name='macro_f1', **kwargs):
            super(MacroF1Metric, self).__init__(name=name, **kwargs)
            self.tp = self.add_weight(name='tp', shape=(len(CLASS_NAMES),), initializer='zeros')
            self.fp = self.add_weight(name='fp', shape=(len(CLASS_NAMES),), initializer='zeros')
            self.fn = self.add_weight(name='fn', shape=(len(CLASS_NAMES),), initializer='zeros')

        def update_state(self, y_true, y_pred, sample_weight=None):
            y_true = tf.cast(y_true, tf.int32)
            y_pred = tf.argmax(y_pred, axis=1, output_type=tf.int32)
            y_true_one_hot = tf.one_hot(y_true, depth=len(CLASS_NAMES))
            y_pred_one_hot = tf.one_hot(y_pred, depth=len(CLASS_NAMES))
            
            # Eğer sample_weight kullanılmak istenirse tf.reduce_sum kısmına çarpılarak eklenebilir,
            # ancak biz sadece saf tahmin doğruluğunu ölçmek istiyoruz.
            self.tp.assign_add(tf.reduce_sum(y_true_one_hot * y_pred_one_hot, axis=0))
            self.fp.assign_add(tf.reduce_sum((1 - y_true_one_hot) * y_pred_one_hot, axis=0))
            self.fn.assign_add(tf.reduce_sum(y_true_one_hot * (1 - y_pred_one_hot), axis=0))

        def result(self):
            precision = self.tp / (self.tp + self.fp + K.epsilon())
            recall = self.tp / (self.tp + self.fn + K.epsilon())
            f1 = 2 * precision * recall / (precision + recall + K.epsilon())
            return tf.reduce_mean(f1)

        def reset_state(self):
            self.tp.assign(tf.zeros((len(CLASS_NAMES),)))
            self.fp.assign(tf.zeros((len(CLASS_NAMES),)))
            self.fn.assign(tf.zeros((len(CLASS_NAMES),)))

    # F1 Farkını terminale basacak olan Callback
    class F1DifferenceCallback(keras.callbacks.Callback):
        def on_epoch_end(self, epoch, logs=None):
            logs = logs or {}
            train_f1 = logs.get("macro_f1")
            val_f1 = logs.get("val_macro_f1")
            if train_f1 is not None and val_f1 is not None:
                diff = train_f1 - val_f1
                # Pozitif fark: Train daha iyi (Normal/Overfit riski), Negatif fark: Val daha iyi (Underfit)
                print(f"  --> [F1 Raporu] Train F1: {train_f1:.4f} | Val F1: {val_f1:.4f} | Fark (Overfit Riski): {diff:.4f}")

    # Adım 1: Sınıf dağılımlarını hesapla (Base Class Weights için)
    label_counts = Counter()
    fb_count = 0
    for i, cls in enumerate(CLASS_NAMES):
        orig_dir = os.path.join(ORIGINAL_DATASET_DIR, cls)
        fb_dir = os.path.join(FEEDBACK_DOWNLOAD_DIR, cls)
        if os.path.isdir(orig_dir):
            label_counts[i] += len([f for f in os.listdir(orig_dir) if not f.startswith('.')])
        if os.path.isdir(fb_dir):
            c = len([f for f in os.listdir(fb_dir) if not f.startswith('.') and f != "feedback_meta.json"])
            label_counts[i] += c
            fb_count += c

    total = sum(label_counts.values())
    class_weight_dict = {i: total / (len(CLASS_NAMES) * max(1, label_counts[i])) 
                         for i in range(len(CLASS_NAMES))}
    print("  Base Class weights:", class_weight_dict)

    # Adım 2: Orijinal ve Feedback Dataset'leri (Unbatched) Yarat
    train_ds_orig = keras.utils.image_dataset_from_directory(
        ORIGINAL_DATASET_DIR, validation_split=0.2, subset="training",
        seed=123, image_size=(IMG_HEIGHT, IMG_WIDTH), batch_size=None,
        class_names=CLASS_NAMES)
    
    val_ds = keras.utils.image_dataset_from_directory(
        ORIGINAL_DATASET_DIR, validation_split=0.2, subset="validation",
        seed=123, image_size=(IMG_HEIGHT, IMG_WIDTH), batch_size=BATCH_SIZE,
        class_names=CLASS_NAMES)

    class_names = train_ds_orig.class_names

    # Decay (Sönümlenme) mekanizması için Epoch Takipçisi
    current_epoch = tf.Variable(0, dtype=tf.float32, trainable=False)

    class EpochUpdateCallback(keras.callbacks.Callback):
        def on_epoch_begin(self, epoch, logs=None):
            current_epoch.assign(epoch)

    # Class Weight Lookup Table
    keys = tf.constant(list(class_weight_dict.keys()), dtype=tf.int32)
    values = tf.constant(list(class_weight_dict.values()), dtype=tf.float32)
    init = tf.lookup.KeyValueTensorInitializer(keys, values)
    class_weight_table = tf.lookup.StaticHashTable(init, default_value=1.0)

    # Feedback Weight (Decay logic)
    def calculate_feedback_weight(epoch):
        decay_rate = 0.2
        return tf.maximum(tf.constant(MIN_FEEDBACK_WEIGHT, dtype=tf.float32), 
                          tf.constant(BASE_FEEDBACK_WEIGHT, dtype=tf.float32) - decay_rate * epoch)

    # Orijinal veriler için (image, label, sample_weight) eşlemesi
    def map_orig(image, label):
        base_cw = class_weight_table.lookup(tf.cast(label, tf.int32))
        final_w = tf.clip_by_value(base_cw, 0.5, WEIGHT_CLIP_MAX)
        return image, label, final_w

    # Feedback verileri için (image, label, sample_weight) eşlemesi
    def map_fb(image, label):
        base_cw = class_weight_table.lookup(tf.cast(label, tf.int32))
        dyn_weight = calculate_feedback_weight(current_epoch) # Dinamik çürüyen ağırlık
        # Çarpma yerine LOGARİTMİK ve TOPLAMSAL yumuşatma: Daha kararlı sonuçlar verir
        final_w = base_cw + tf.math.log(dyn_weight + 1.0)
        final_w = tf.clip_by_value(final_w, 0.5, WEIGHT_CLIP_MAX)
        return image, label, final_w

    AUTOTUNE = tf.data.AUTOTUNE
    train_ds_orig = train_ds_orig.map(map_orig, num_parallel_calls=AUTOTUNE)

    # Adım 3: Stratified Sampling (Mix Ratio koruması)
    if fb_count > 0:
        print(f"  Found {fb_count} feedback images. Applying Stratified Sampling.")
        
        # Hata vermemesi için FEEDBACK klasöründe tüm sınıf isimlerinde boş klasör oluştur
        for cls in CLASS_NAMES:
            os.makedirs(os.path.join(FEEDBACK_DOWNLOAD_DIR, cls), exist_ok=True)
            
        train_ds_fb = keras.utils.image_dataset_from_directory(
            FEEDBACK_DOWNLOAD_DIR, image_size=(IMG_HEIGHT, IMG_WIDTH), 
            batch_size=None, class_names=CLASS_NAMES)
        
        # Feedback verilerini sonsuz döndürerek örneklemeye (sample_from_datasets) hazırlıyoruz
        train_ds_fb = train_ds_fb.map(map_fb, num_parallel_calls=AUTOTUNE).repeat()
        
        # Orijinal ve Feedback verilerini batch'lerin içine FEEDBACK_MIX_RATIO oranında karıştırıyoruz
        train_ds = tf.data.Dataset.sample_from_datasets(
            [train_ds_orig, train_ds_fb],
            weights=[1.0 - FEEDBACK_MIX_RATIO, FEEDBACK_MIX_RATIO],
            stop_on_empty_dataset=True # Orijinal veri bittiğinde epoch biter
        )
    else:
        print("  No feedback images found. Using only original dataset.")
        train_ds = train_ds_orig

    # Batchleme ve optimize etme
    train_ds = train_ds.cache().shuffle(1000).batch(BATCH_SIZE).prefetch(AUTOTUNE)
    val_ds = val_ds.cache().prefetch(AUTOTUNE)

    # Veri artırma (Data Augmentation)
    data_aug = keras.Sequential([
        layers.RandomFlip("horizontal_and_vertical"),
        layers.RandomRotation(0.2),
        layers.RandomZoom(0.1),
        layers.RandomContrast(0.1),
        layers.RandomBrightness(0.1),
    ])

    base_model = keras.applications.MobileNetV2(
        input_shape=(IMG_HEIGHT, IMG_WIDTH, 3),
        include_top=False, weights="imagenet")
    base_model.trainable = False

    model = keras.Sequential([
        layers.Input(shape=(IMG_HEIGHT, IMG_WIDTH, 3)),
        data_aug,
        layers.Lambda(keras.applications.mobilenet_v2.preprocess_input),
        base_model,
        layers.GlobalAveragePooling2D(),
        layers.Dense(256, activation="relu",
                     kernel_regularizer=keras.regularizers.l2(1e-4)),
        layers.Dropout(0.4),
        layers.Dense(len(class_names), activation="softmax"),
    ])

    # Keras'ın model.fit() metodunda sample_weight'i otomatik olarak kullanması için extra parametre vermiyoruz.
    # class_weight parametresi KALDIRILDI çünkü Final_Weight dataset içerisinde halledildi.
    model.compile(optimizer=keras.optimizers.Adam(LEARNING_RATE),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy", MacroF1Metric()])

    early_stop = keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=EARLY_STOP_PATIENCE, restore_best_weights=True)
    epoch_cb = EpochUpdateCallback()
    f1_diff_cb = F1DifferenceCallback()

    print("  Phase 1 — Transfer learning (frozen backbone) …")
    history = model.fit(train_ds, validation_data=val_ds, epochs=EPOCHS,
                        callbacks=[early_stop, epoch_cb, f1_diff_cb])

    # Fine-tune
    if FINE_TUNE_LAYERS > 0:
        print(f"  Phase 2 — Fine-tuning last {FINE_TUNE_LAYERS} layers …")
        base_model.trainable = True
        for layer in base_model.layers[:-FINE_TUNE_LAYERS]:
            layer.trainable = False
        model.compile(optimizer=keras.optimizers.Adam(FINE_TUNE_LR),
                      loss="sparse_categorical_crossentropy", metrics=["accuracy", MacroF1Metric()])
        history_ft = model.fit(train_ds, validation_data=val_ds,
                               epochs=FINE_TUNE_EPOCHS, callbacks=[early_stop, epoch_cb, f1_diff_cb])
        # merge histories
        for k in history.history:
            history.history[k].extend(history_ft.history.get(k, []))

    return model, history, class_names, val_ds


# ---------------------------------------------------------------------------
# 7. EVALUATE & QUALITY GATE
# ---------------------------------------------------------------------------
def evaluate_model(model, val_ds, class_names):
    """Return True if model passes quality gate."""
    from sklearn.metrics import classification_report, f1_score, confusion_matrix

    print("\n[7/9] Evaluating model …")

    val_images, val_labels = [], []
    for imgs, lbls in val_ds:
        val_images.append(imgs.numpy())
        val_labels.append(lbls.numpy())
    val_images = np.concatenate(val_images)
    val_labels = np.concatenate(val_labels).astype(int)

    preds = np.argmax(model.predict(val_images), axis=1)
    macro_f1 = f1_score(val_labels, preds, average="macro")

    report_dict = classification_report(val_labels, preds,
                                        target_names=class_names, output_dict=True)
    report_str = classification_report(val_labels, preds, target_names=class_names)
    cm = confusion_matrix(val_labels, preds)

    print("  Confusion Matrix:\n", cm)
    print("\n", report_str)
    print(f"  Macro F1: {macro_f1:.4f}  (threshold: {MIN_MACRO_F1})")

    # Çıktı klasörünün var olduğundan emin ol
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Confusion Matrix grafiği çiz ve kaydet
    try:
        from sklearn.metrics import ConfusionMatrixDisplay
        import matplotlib.pyplot as plt
        disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=class_names)
        fig, ax = plt.subplots(figsize=(10, 8))
        disp.plot(ax=ax, cmap="Blues", xticks_rotation=45)
        plt.title("Confusion Matrix")
        plt.tight_layout()
        cm_path = os.path.join(OUTPUT_DIR, "confusion_matrix.png")
        plt.savefig(cm_path, dpi=150)
        plt.show(block=False) # Ekrana yansıt ama programı kilitleme
    except Exception as e:
        print(f"  ⚠ Confusion matrix grafiği çizilemedi: {e}")

    # Quality gate
    passed = True
    if macro_f1 < MIN_MACRO_F1:
        print(f"  ✗ FAILED: Macro F1 {macro_f1:.4f} < {MIN_MACRO_F1}")
        passed = False

    for cls in class_names:
        r = report_dict.get(cls, {})
        rec, prec = r.get("recall", 0), r.get("precision", 0)
        if rec < MIN_CLASS_RECALL:
            print(f"  ✗ FAILED: {cls} recall {rec:.4f} < {MIN_CLASS_RECALL}")
            passed = False
        if prec < MIN_CLASS_PRECISION:
            print(f"  ✗ FAILED: {cls} precision {prec:.4f} < {MIN_CLASS_PRECISION}")
            passed = False

    if passed:
        print("  ✓ Model PASSED quality gate.")
    return passed, macro_f1, report_dict


# ---------------------------------------------------------------------------
# 8. TFLITE CONVERSION
# ---------------------------------------------------------------------------
def convert_to_tflite(model, version_tag):
    """Convert to float32 and int8-quantized TFLite models."""
    import tensorflow as tf

    print("\n[8/9] Converting to TFLite …")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Float32
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_fp32 = converter.convert()
    fp32_path = os.path.join(OUTPUT_DIR, f"model_{version_tag}_fp32.tflite")
    with open(fp32_path, "wb") as f:
        f.write(tflite_fp32)
    print(f"  → FP32: {fp32_path}  ({len(tflite_fp32)/1024/1024:.1f} MB)")

    # INT8 quantized
    converter2 = tf.lite.TFLiteConverter.from_keras_model(model)
    converter2.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_int8 = converter2.convert()
    int8_path = os.path.join(OUTPUT_DIR, f"model_{version_tag}_int8.tflite")
    with open(int8_path, "wb") as f:
        f.write(tflite_int8)
    print(f"  → INT8: {int8_path}  ({len(tflite_int8)/1024/1024:.1f} MB)")

    # Also save default model.tflite (fp32) for direct app use
    default_path = os.path.join(OUTPUT_DIR, "model.tflite")
    shutil.copy2(fp32_path, default_path)

    # Save keras model
    keras_path = os.path.join(OUTPUT_DIR, f"model_{version_tag}.keras")
    model.save(keras_path)
    print(f"  → Keras: {keras_path}")

    return fp32_path, int8_path


# ---------------------------------------------------------------------------
# 9. VERSIONING & SUMMARY
# ---------------------------------------------------------------------------
def bump_version():
    """Generate next version tag from current."""
    parts = CURRENT_MODEL_VERSION.replace("v", "").split("-")[0].split(".")
    major, minor, patch = int(parts[0]), int(parts[1]), int(parts[2])
    patch += 1
    return f"v{major}.{minor}.{patch}-tflite-fp32"


def save_training_report(version_tag, macro_f1, report_dict, fp32_path, int8_path):
    """Save JSON report with all details."""
    report = {
        "version": version_tag,
        "previous_version": CURRENT_MODEL_VERSION,
        "timestamp": datetime.datetime.now().isoformat(),
        "macro_f1": round(macro_f1, 4),
        "per_class": {cls: {
            "precision": round(report_dict[cls]["precision"], 4),
            "recall": round(report_dict[cls]["recall"], 4),
            "f1": round(report_dict[cls]["f1-score"], 4),
            "support": report_dict[cls]["support"],
        } for cls in CLASS_NAMES if cls in report_dict},
        "artifacts": {
            "fp32_tflite": fp32_path,
            "int8_tflite": int8_path,
        },
        "config": {
            "feedback_mix_ratio": FEEDBACK_MIX_RATIO,
            "epochs": EPOCHS,
            "fine_tune_layers": FINE_TUNE_LAYERS,
            "fine_tune_epochs": FINE_TUNE_EPOCHS,
            "learning_rate": LEARNING_RATE,
            "min_macro_f1": MIN_MACRO_F1,
        }
    }
    rpath = os.path.join(OUTPUT_DIR, f"training_report_{version_tag}.json")
    with open(rpath, "w") as f:
        json.dump(report, f, indent=2)
    print(f"  → Report: {rpath}")
    return rpath


def deploy_to_app(version_tag):
    """Copy model.tflite into src/assets/ for the React Native app."""
    src = os.path.join(OUTPUT_DIR, "model.tflite")
    assets_dir = os.path.join(BASE_DIR, "..", "src", "assets")
    dst = os.path.join(assets_dir, "model.tflite")
    if os.path.isdir(assets_dir):
        shutil.copy2(src, dst)
        print(f"  → Deployed model.tflite to {dst}")
    else:
        print(f"  ⚠ Assets directory not found: {assets_dir}")
        print(f"    Manually copy {src} to your app assets.")

    # Update MODEL_DEPLOYMENT_TAG in wasteFeedbackService.ts
    svc_path = os.path.join(BASE_DIR, "..", "src", "services", "wasteFeedbackService.ts")
    if os.path.isfile(svc_path):
        with open(svc_path, "r", encoding="utf-8") as f:
            content = f.read()
        old_tag = f"'{CURRENT_MODEL_VERSION}'"
        new_tag = f"'{version_tag}'"
        if old_tag in content:
            content = content.replace(old_tag, new_tag)
            with open(svc_path, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"  → Updated MODEL_DEPLOYMENT_TAG: {CURRENT_MODEL_VERSION} → {version_tag}")
        else:
            print(f"  ⚠ Could not find tag '{CURRENT_MODEL_VERSION}' in {svc_path}")


def plot_history(history, version_tag):
    """Save training history plot and display it."""
    import matplotlib.pyplot as plt

    plt.figure(figsize=(14, 5))
    plt.subplot(1, 2, 1)
    plt.plot(history.history["loss"], label="Train Loss")
    plt.plot(history.history["val_loss"], label="Val Loss")
    plt.title("Loss"); plt.xlabel("Epoch"); plt.ylabel("Loss"); plt.legend()

    plt.subplot(1, 2, 2)
    plt.plot(history.history["accuracy"], label="Train Acc")
    plt.plot(history.history["val_accuracy"], label="Val Acc")
    plt.title("Accuracy"); plt.xlabel("Epoch"); plt.ylabel("Accuracy"); plt.legend()

    plt.tight_layout()
    fig_path = os.path.join(OUTPUT_DIR, f"training_history_{version_tag}.png")
    plt.savefig(fig_path, dpi=150)
    print(f"  → Training plot: {fig_path}")
    plt.show(block=False) # Ekrana yansıt ama programı kilitleme


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(description="Feedback-enhanced training pipeline")
    parser.add_argument("--skip-qa", action="store_true",
                        help="Skip interactive human QA step")
    parser.add_argument("--skip-download", action="store_true",
                        help="Skip Supabase export/download (use existing feedback_images/)")
    parser.add_argument("--force-deploy", action="store_true",
                        help="Deploy even if quality gate fails")
    parser.add_argument("--no-finetune", action="store_true",
                        help="Skip fine-tuning phase")
    args = parser.parse_args()

    print("=" * 60)
    print("  WASTE CLASSIFICATION — FEEDBACK TRAINING PIPELINE")
    print("=" * 60)

    version_tag = bump_version()
    print(f"  New version: {version_tag}")
    print(f"  Previous:    {CURRENT_MODEL_VERSION}")

    # Steps 1-2: Data acquisition
    if not args.skip_download:
        rows = export_feedback()
        if rows:
            download_feedback_images(rows)
        else:
            print("  ⚠ No feedback rows found. Training with original data only.")
    else:
        print("\n[1-2/9] Skipped download (--skip-download)")

    # Step 3: Clean
    clean_and_validate()

    # Step 4: QA
    if not args.skip_qa:
        human_qa()
    else:
        print("\n[4/9] Skipped QA (--skip-qa)")

    # Step 5: Merge
    # merge_and_balance() işlevi train_model içerisine taşındı.

    # Step 6: Train
    if args.no_finetune:
        import pipeline_config
        pipeline_config.FINE_TUNE_LAYERS = 0
    model, history, class_names, val_ds = train_model()

    # Step 7: Evaluate
    passed, macro_f1, report_dict = evaluate_model(model, val_ds, class_names)

    if not passed and not args.force_deploy:
        print("\n" + "!" * 60)
        print("  MODEL DID NOT PASS QUALITY GATE — ABORTING DEPLOYMENT")
        print("  Use --force-deploy to override.")
        print("!" * 60)
        # Still save artifacts for inspection
        fp32_path, int8_path = convert_to_tflite(model, version_tag + "-FAILED")
        plot_history(history, version_tag + "-FAILED")
        sys.exit(1)

    # Step 8: Convert
    fp32_path, int8_path = convert_to_tflite(model, version_tag)

    # Step 9: Version, report, deploy
    print("\n[9/9] Versioning & deployment …")
    plot_history(history, version_tag)
    save_training_report(version_tag, macro_f1, report_dict, fp32_path, int8_path)
    deploy_to_app(version_tag)

    print("\n" + "=" * 60)
    print("  ✓ PIPELINE COMPLETE")
    print(f"  Model version : {version_tag}")
    print(f"  Macro F1      : {macro_f1:.4f}")
    print(f"  Output dir    : {OUTPUT_DIR}")
    print("=" * 60)
    
    # Açılan grafik pencerelerinin kapanmaması için programın sonunda bekle
    import matplotlib.pyplot as plt
    print("\nGrafikleri inceleyebilirsiniz. Pencereleri kapattığınızda program sonlanacaktır.")
    plt.show()


if __name__ == "__main__":
    main()
