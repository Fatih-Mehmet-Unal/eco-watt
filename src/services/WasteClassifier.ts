
import Tflite from 'react-native-tflite';
import { Platform } from 'react-native';


export interface WasteClassificationResult {
    type: string;
    binColor: string;
    description: string;
    confidence: number;
}

const tflite = new Tflite();
const modelPath = Platform.OS === 'ios' ? 'model.tflite' : 'src/assets/model.tflite';
const labels = ['cardboard', 'glass', 'metal', 'paper', 'plastic', 'trash'];

// Modeli yükle (uygulama başında bir kez çağrılmalı)
tflite.loadModel({
    model: modelPath,
    labels: labels,
}, (err: any, res: any) => {
    if (err) console.error('TFLite load error:', err);

});


export const classifyImage = async (imageUri: string): Promise<WasteClassificationResult> => {
    return new Promise((resolve, reject) => {
        tflite.runModelOnImage({
            path: imageUri,
            imageMean: 0,
            imageStd: 255,
            numResults: 6,
            threshold: 0.05,
        }, (err: any, results: any[]) => {
            if (err) {
                console.error('TFLite inference error:', err);
                reject('Atık analizi yapılamadı.');
                return;
            }
            if (!results || results.length === 0) {
                resolve({
                    type: 'Bilinmiyor',
                    binColor: '#808080',
                    description: 'Atık tespit edilemedi.',
                    confidence: 0,
                });
                return;
            }
            // En yüksek olasılıklı sonucu al
            const top = results[0];
            // Bin color ve description mapping
            const binColors: { [key: string]: string } = {
                plastic: 'Yellow',
                paper: 'Blue',
                glass: 'Green',
                metal: 'Gray',
                cardboard: 'Brown',
                trash: 'Black',
            };
            const descriptions: { [key: string]: string } = {
                plastic: 'Plastiği yıkayıp sıkıştırarak atın.',
                paper: 'Kağıdı temiz ve kuru şekilde mavi kutuya atın.',
                glass: 'Camı kırmadan yeşil kutuya atın.',
                metal: 'Metali ezip gri kutuya atın.',
                cardboard: 'Kartonu katlayıp kahverengi kutuya atın.',
                trash: 'Çöpü siyah kutuya atın.',
            };
            resolve({
                type: top.label || 'Bilinmiyor',
                binColor: binColors[top.label] || '#808080',
                description: descriptions[top.label] || 'Analiz sonucu alınamadı.',
                confidence: top.confidence || 0,
            });
        });
    });
};
