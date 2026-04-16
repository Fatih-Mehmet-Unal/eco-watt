# Kendi Görsel Sınıflandırma Modelimizi Eğitme

#Bu dosya, TensorFlow/Keras ile örnek bir image classifier modelinin nasıl eğitileceğini ve TFLite formatına nasıl #dönüştürüleceğini gösterir.

## Adımlar
#1. Gerekli kütüphaneleri yükle
#2. Veri setini hazırla (örnek: keras.datasets veya kendi verin)
#3. Modeli eğit
#4. Modeli TFLite formatına dönüştür

#-#--

#``#`python
# 1. Gerekli kütüphaneler


# Kaggle'dan dataset otomatik indirme
# Dataset slug: farzadnekouei/trash-type-image-dataset
import os
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
if not os.path.exists('./ml-model/dataset'):
    os.makedirs('./ml-model/dataset')
os.system('kaggle datasets download -d farzadnekouei/trash-type-image-dataset -p ./ml-model/dataset --unzip')

# Gelişmiş data augmentation (çöp datasetine uygun)
data_augmentation = keras.Sequential([
    layers.RandomFlip("horizontal"),
    layers.RandomRotation(0.1),  # 10 derece
    layers.RandomZoom(0.1),
    layers.RandomContrast(0.1),
    layers.RandomBrightness(0.1),
    layers.RandomCrop(224, 224)
])


# Kendi Görsel Sınıflandırma Modelimizi Eğitme
# Bu dosya, TensorFlow/Keras ile örnek bir image classifier modelinin nasıl eğitileceğini ve TFLite formatına nasıl dönüştürüleceğini gösterir.
# Adımlar:
# 1. Gerekli kütüphaneleri yükle
# 2. Veri setini hazırla (örnek: keras.datasets veya kendi verin)
# 3. Modeli eğit
# 4. Modeli TFLite formatına dönüştür
# ---


# Data augmentation (veri artırma)
data_augmentation = keras.Sequential([
    layers.RandomFlip("horizontal_and_vertical"),
    layers.RandomRotation(0.2),
    layers.RandomZoom(0.1),
])


# 2. Kendi datasetini yükle (klasörlerden)
data_dir = './ml-model/dataset/TrashType_Image_Dataset'
img_height = 224
img_width = 224
batch_size = 32

# Train ve validation setlerini otomatik oluştur
train_ds = tf.keras.utils.image_dataset_from_directory(
    data_dir,
    validation_split=0.2,
    subset="training",
    seed=123,
    image_size=(img_height, img_width),
    batch_size=batch_size
)
val_ds = tf.keras.utils.image_dataset_from_directory(
    data_dir,
    validation_split=0.2,
    subset="validation",
    seed=123,
    image_size=(img_height, img_width),
    batch_size=batch_size
)
# Sınıf isimlerini al (önce alınmalı)
class_names = train_ds.class_names
print("Sınıflar:", class_names)

# --- Class Weights Hesaplama ---
from collections import Counter
labels_list = []
for batch in train_ds:
    _, labels = batch
    labels_list.extend(labels.numpy())
label_counts = Counter(labels_list)
total = sum(label_counts.values())
class_weight = {i: total/(len(class_names)*label_counts[i]) for i in range(len(class_names))}
print("Class weights:", class_weight)

# Sınıf isimlerini al
class_names = train_ds.class_names
print("Sınıflar:", class_names)

# Performans için önbellekleme

# --- trash için ekstra augmentation ---
def custom_augmentation(image, label):
    trash_idx = class_names.index('trash')
    if label == trash_idx:
        image = tf.image.random_flip_left_right(image)
        image = tf.image.random_brightness(image, max_delta=0.2)
        image = tf.image.random_contrast(image, 0.8, 1.2)
        image = tf.image.random_saturation(image, 0.8, 1.2)
        image = tf.image.random_hue(image, 0.08)
    return image, label

AUTOTUNE = tf.data.AUTOTUNE
# Önce batch_size=1 ile augmentation uygula, sonra tekrar batch'le
train_ds_aug = train_ds.unbatch().map(custom_augmentation).batch(batch_size)
train_ds_aug = train_ds_aug.cache().shuffle(1000).prefetch(buffer_size=AUTOTUNE)
val_ds = val_ds.cache().prefetch(buffer_size=AUTOTUNE)


# 3. Transfer Learning ile Model (MobileNetV2 backbone)
base_model = keras.applications.MobileNetV2(
    input_shape=(img_height, img_width, 3),
    include_top=False,
    weights='imagenet'
)
base_model.trainable = False  # İlk başta sadece son katmanları eğit

model = keras.Sequential([
    layers.Input(shape=(img_height, img_width, 3)),
    data_augmentation,
    layers.Lambda(keras.applications.mobilenet_v2.preprocess_input),
    base_model,
    layers.GlobalAveragePooling2D(),
    layers.Dense(256, activation='relu', kernel_regularizer=keras.regularizers.l2(1e-4)),
    layers.Dropout(0.4),
    layers.Dense(len(class_names), activation='softmax')
])



# Daha düşük learning rate ile Adam optimizer
optimizer = keras.optimizers.Adam(learning_rate=0.0005)
model.compile(optimizer=optimizer,
              loss='sparse_categorical_crossentropy',
              metrics=['accuracy'])

# EarlyStopping callback
early_stop = keras.callbacks.EarlyStopping(monitor='val_loss', patience=3, restore_best_weights=True)
history = model.fit(
    train_ds_aug,
    validation_data=val_ds,
    epochs=30,
    callbacks=[early_stop],
    class_weight=class_weight
)

# --- Confusion Matrix, Precision/Recall, F1-score ---
import numpy as np
from sklearn.metrics import confusion_matrix, classification_report, f1_score
import matplotlib.pyplot as plt

# Validation set için gerçek ve tahmin edilen label'ları al
val_images = []
val_labels = []
for batch in val_ds:
    images, labels = batch
    val_images.append(images)
    val_labels.append(labels)
val_images = np.concatenate(val_images)
val_labels = np.concatenate(val_labels)

# Modelden tahminler al
pred_probs = model.predict(val_images)
pred_labels = np.argmax(pred_probs, axis=1)
true_labels = val_labels.astype(int)

# Confusion matrix
cm = confusion_matrix(true_labels, pred_labels)
print("Confusion Matrix:")
print(cm)

# Classification report (precision, recall, f1-score)

# Macro F1-score
macro_f1 = f1_score(true_labels, pred_labels, average='macro')
print(f"\nMacro F1-score: {macro_f1:.4f}")

target_names = class_names
report = classification_report(true_labels, pred_labels, target_names=target_names)
print("\nClassification Report:")
print(report)

# --- Loss ve Accuracy Grafiklerini Çiz ---
def plot_history(history):
    plt.figure(figsize=(12,5))
    # Loss
    plt.subplot(1,2,1)
    plt.plot(history.history['loss'], label='Train Loss')
    plt.plot(history.history['val_loss'], label='Val Loss')
    plt.title('Loss')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.legend()
    # Accuracy
    plt.subplot(1,2,2)
    plt.plot(history.history['accuracy'], label='Train Acc')
    plt.plot(history.history['val_accuracy'], label='Val Acc')
    plt.title('Accuracy')
    plt.xlabel('Epoch')
    plt.ylabel('Accuracy')
    plt.legend()
    plt.tight_layout()
    plt.savefig('training_history.png')
    plt.show()

plot_history(history)

# 4. Modeli kaydetme (Keras formatı)
model.save('my_classifier_model.keras')

# 5. TFLite'a dönüştürme (doğrudan model nesnesinden)
converter = tf.lite.TFLiteConverter.from_keras_model(model)
tflite_model = converter.convert()
with open('model.tflite', 'wb') as f:
    f.write(tflite_model)
#```

#---

#Kendi veri setinle çalışmak için `keras.datasets.mnist` yerine kendi veri yükleme kodunu ekleyebilirsin. Modeli #eğittikten sonra `model.tflite` dosyasını React Native uygulamana entegre edeceğiz.