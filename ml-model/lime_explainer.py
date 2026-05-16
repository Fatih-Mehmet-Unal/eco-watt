import os
import numpy as np
import tensorflow as tf
from tensorflow import keras
import matplotlib.pyplot as plt
from lime import lime_image
from skimage.segmentation import mark_boundaries
from pipeline_config import IMG_HEIGHT, IMG_WIDTH, CLASS_NAMES

def explain_prediction_with_lime(model, image_path, predicted_class_idx=None, output_path=None):
    """
    LIME (Local Interpretable Model-agnostic Explanations) kullanarak
    modelin tahmin yaparken resmin hangi bölgelerine (super-pixels) 
    odaklandığını gösteren bir ısı haritası (maske) üretir.
    
    Args:
        model: Eğitilmiş Keras modeli.
        image_path (str): Açıklanacak resmin dosya yolu.
        predicted_class_idx (int, optional): Açıklama üretilecek sınıfın indeksi. 
            Eğer None ise, modelin en yüksek olasılık verdiği sınıf kullanılır.
        output_path (str, optional): Üretilen görselin kaydedileceği yol.
    """
    print(f"\n[LIME] Açıklanabilirlik haritası üretiliyor: {image_path}")
    
    # 1. Resmi yükle ve modele uygun formata getir
    img = keras.utils.load_img(image_path, target_size=(IMG_HEIGHT, IMG_WIDTH))
    img_array = keras.utils.img_to_array(img)
    # Modelimizin içinde Lambda(preprocess_input) olduğu için buraya ham resmi veriyoruz
    # LIME, resmi float64 [0,1] veya [0,255] olarak manipüle eder, uint8 resim üzerinden çalışalım
    
    img_array_expanded = np.expand_dims(img_array, axis=0)
    
    # 2. Eğer hedef sınıf verilmediyse, modelin tahminini kullan
    if predicted_class_idx is None:
        preds = model.predict(img_array_expanded)
        predicted_class_idx = np.argmax(preds[0])
        print(f"[LIME] Model Tahmini: {CLASS_NAMES[predicted_class_idx]} ({preds[0][predicted_class_idx]:.2f})")

    # 3. LIME Explainer objesini oluştur
    explainer = lime_image.LimeImageExplainer(random_state=42)
    
    # LIME'ın manipüle edeceği predict fonksiyonu
    # LIME, (N, H, W, 3) boyutunda float/int diziler gönderir.
    def predict_fn(images):
        return model.predict(images)

    # 4. Açıklamayı oluştur (hide_color=0 siyah piksel ile kapatır)
    explanation = explainer.explain_instance(
        img_array.astype('uint8'), # LIME uint8 bekler
        predict_fn, 
        top_labels=5, 
        hide_color=0, 
        num_samples=1000 # Üretilecek perturbasyon sayısı (hız/kalite dengesi için 1000)
    )

    # 5. Görselleştirme için maskeyi ve sınırları al
    temp, mask = explanation.get_image_and_mask(
        predicted_class_idx, 
        positive_only=True, # Sadece tahmine olumlu etki eden bölgeleri göster
        num_features=5,     # En önemli 5 bölge
        hide_rest=False     # Geri kalan resmi tamamen gizleme (karartma yap)
    )

    # Heatmap/Maske görselleştirme
    plt.figure(figsize=(8, 8))
    plt.imshow(mark_boundaries(temp / 255.0, mask))
    class_name = CLASS_NAMES[predicted_class_idx]
    plt.title(f"LIME Açıklaması: {class_name}")
    plt.axis('off')
    
    # Kaydet veya göster
    if output_path is None:
        output_name = f"lime_explanation_{os.path.basename(image_path)}.png"
        output_path = os.path.join(os.path.dirname(image_path), output_name)
        
    plt.savefig(output_path, bbox_inches='tight', dpi=150)
    plt.close()
    
    print(f"[LIME] Açıklama haritası başarıyla kaydedildi: {output_path}")
    return output_path
