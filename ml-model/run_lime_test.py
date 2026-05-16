import os
import glob
import random
from tensorflow import keras
from lime_explainer import explain_prediction_with_lime
from pipeline_config import OUTPUT_DIR, FEEDBACK_DOWNLOAD_DIR, ORIGINAL_DATASET_DIR

def run_lime_test():
    print("="*50)
    print("  LIME MODEL AÇIKLANABİLİRLİK TESTİ")
    print("="*50)

    # 1. En son eğitilen modeli otomatik bul ve yükle
    keras_modelleri = glob.glob(os.path.join(OUTPUT_DIR, "*.keras"))
    if not keras_modelleri:
        print("-> Hata: output klasorunde egitilmis bir .keras modeli bulunamadi!")
        return
    
    # En yeni dosyayı seç
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    
    en_yeni_model = max(keras_modelleri, key=os.path.getctime)
    print(f"-> Model Yukleniyor: {os.path.basename(en_yeni_model)}")
    model = keras.models.load_model(en_yeni_model, custom_objects={'preprocess_input': preprocess_input}, compile=False)
    print("-> Model basariyla yuklendi.\n")

    # 2. Test etmek için rastgele bir resim seç (Önce geri bildirimleri ara, yoksa orijinal veri setine bak)
    tum_resimler = glob.glob(os.path.join(FEEDBACK_DOWNLOAD_DIR, "*", "*.jpg"))
    if not tum_resimler:
        tum_resimler = glob.glob(os.path.join(ORIGINAL_DATASET_DIR, "*", "*.jpg"))
        
    if not tum_resimler:
        print("-> Hata: Test edilecek hicbir .jpg resmi bulunamadi!")
        return

    test_resmi = random.choice(tum_resimler)
    gercek_sinif = os.path.basename(os.path.dirname(test_resmi))
    
    print(f"-> Test Resmi Secildi: {os.path.basename(test_resmi)}")
    print(f"   Gercek Sinifi: {gercek_sinif}\n")

    # 3. LIME fonksiyonunu çalıştır
    print("-> LIME analizi baslatiliyor... (Bu islem resmin boyutuna gore 10-30 saniye surebilir)")
    
    # Kaydedilecek klasör olarak çıktı klasörünü kullanalım
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    cikis_yolu = os.path.join(OUTPUT_DIR, f"lime_sonucu_{os.path.basename(test_resmi)}.png")
    
    uretilen_harita_yolu = explain_prediction_with_lime(
        model=model, 
        image_path=test_resmi, 
        output_path=cikis_yolu
    )

    print("\n" + "="*50)
    print("-> LIME TESTI BASARIYLA TAMAMLANDI!")
    print(f"-> Sonuc fotografi buraya kaydedildi: {uretilen_harita_yolu}")
    print("="*50)

    # Windows'ta fotoğrafı otomatik olarak ekranda açmak için:
    try:
        os.startfile(uretilen_harita_yolu)
    except Exception as e:
        pass

if __name__ == "__main__":
    run_lime_test()
