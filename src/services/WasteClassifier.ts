import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import * as jpeg from 'jpeg-js';

export interface WasteClassificationResult {
    type: string;
    binColor: string;
    description: string;
    confidence: number;
}

// Model labels — must match training class order from train_and_convert_example.py
// Classes come from: tf.keras.utils.image_dataset_from_directory (alphabetical)
const labels = ['cardboard', 'glass', 'metal', 'paper', 'plastic', 'trash'];

// Model input dimensions (MobileNetV2)
const IMG_SIZE = 224;

// Turkish display names
const labelDisplayNames: { [key: string]: string } = {
    cardboard: 'Karton',
    glass: 'Cam',
    metal: 'Metal',
    paper: 'Kağıt',
    plastic: 'Plastik',
    trash: 'Çöp',
};

// Bin colors for each waste type
const binColors: { [key: string]: string } = {
    plastic: '#FFD700',   // Yellow
    paper: '#4169E1',     // Blue
    glass: '#228B22',     // Green
    metal: '#808080',     // Gray
    cardboard: '#8B4513', // Brown
    trash: '#2C2C2C',     // Black
};

// Turkish descriptions for disposal
const descriptions: { [key: string]: string } = {
    plastic: 'Plastiği yıkayıp sıkıştırarak sarı kutuya atın.',
    paper: 'Kağıdı temiz ve kuru şekilde mavi kutuya atın.',
    glass: 'Camı kırmadan yeşil kutuya atın.',
    metal: 'Metali ezip gri kutuya atın.',
    cardboard: 'Kartonu katlayıp kahverengi kutuya atın.',
    trash: 'Genel çöpü siyah kutuya atın.',
};

// Singleton model instance
let model: TensorflowModel | null = null;
let modelLoading: Promise<TensorflowModel> | null = null;

/**
 * Lazily load the TFLite model (only once).
 */
async function getModel(): Promise<TensorflowModel> {
    if (model) return model;

    if (!modelLoading) {
        modelLoading = (async () => {
            // First, try the require() approach (Metro bundled asset)
            const modelSource = require('../assets/model.tflite');
            console.log('[WasteClassifier] Model source from require():', modelSource, typeof modelSource);

            try {
                const loaded = await loadTensorflowModel(modelSource, []);
                model = loaded;
                console.log('[WasteClassifier] Model loaded via require()');
                console.log('[WasteClassifier] Inputs:', JSON.stringify(loaded.inputs));
                console.log('[WasteClassifier] Outputs:', JSON.stringify(loaded.outputs));
                return loaded;
            } catch (requireErr) {
                console.warn('[WasteClassifier] require() failed, trying bundle path...', requireErr);
            }

            // Fallback: try loading from iOS bundle path directly
            // The model.tflite must be in Xcode's "Copy Bundle Resources"
            try {
                const loaded = await loadTensorflowModel(
                    { url: 'model.tflite' },
                    []
                );
                model = loaded;
                console.log('[WasteClassifier] Model loaded via bundle path');
                console.log('[WasteClassifier] Inputs:', JSON.stringify(loaded.inputs));
                console.log('[WasteClassifier] Outputs:', JSON.stringify(loaded.outputs));
                return loaded;
            } catch (bundleErr) {
                console.error('[WasteClassifier] Bundle path also failed:', bundleErr);
                throw bundleErr;
            }
        })().catch((err) => {
            modelLoading = null;
            console.error('[WasteClassifier] Model load error:', err);
            throw err;
        });
    }

    return modelLoading;
}

/**
 * Decode a base64-encoded JPEG into raw RGBA pixel data using jpeg-js,
 * then resize to IMG_SIZE x IMG_SIZE and convert to a Float32Array
 * with MobileNetV2 preprocessing: pixel = (pixel / 127.5) - 1.0
 */
function decodeAndPreprocess(base64: string): Float32Array {
    // 1. Decode base64 → raw JPEG bytes
    const jpegBuffer = Buffer.from(base64, 'base64');

    // 2. Decode JPEG → RGBA pixel data
    const rawImage = jpeg.decode(jpegBuffer, { useTArray: true, formatAsRGBA: true });
    const { width, height, data: rgbaPixels } = rawImage;

    // 3. Bilinear-interpolation resize to IMG_SIZE x IMG_SIZE (RGB only, drop A)
    const outputSize = IMG_SIZE * IMG_SIZE * 3;
    const float32 = new Float32Array(outputSize);

    const xRatio = width / IMG_SIZE;
    const yRatio = height / IMG_SIZE;

    for (let y = 0; y < IMG_SIZE; y++) {
        for (let x = 0; x < IMG_SIZE; x++) {
            // Source coordinates
            const srcX = Math.min(Math.floor(x * xRatio), width - 1);
            const srcY = Math.min(Math.floor(y * yRatio), height - 1);
            const srcIdx = (srcY * width + srcX) * 4; // RGBA stride

            const dstIdx = (y * IMG_SIZE + x) * 3; // RGB stride

            // MobileNetV2 preprocess_input: (pixel / 127.5) - 1.0
            float32[dstIdx]     = (rgbaPixels[srcIdx]     / 127.5) - 1.0; // R
            float32[dstIdx + 1] = (rgbaPixels[srcIdx + 1] / 127.5) - 1.0; // G
            float32[dstIdx + 2] = (rgbaPixels[srcIdx + 2] / 127.5) - 1.0; // B
        }
    }

    return float32;
}

/**
 * Argmax: find the index of the maximum value.
 */
function argmax(arr: ArrayLike<number>): number {
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > maxVal) {
            maxVal = arr[i];
            maxIdx = i;
        }
    }
    return maxIdx;
}

/**
 * Softmax: convert raw logits to probabilities.
 */
function softmax(arr: ArrayLike<number>): number[] {
    const values = Array.from(arr);
    const maxVal = Math.max(...values);
    const exps = values.map(v => Math.exp(v - maxVal));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumExps);
}

/**
 * Classify a waste image using the on-device TFLite model.
 *
 * @param imageUri  - URI of the image (not directly used, kept for API compat)
 * @param base64    - Base64 encoded JPEG image data
 */
export const classifyImage = async (
    imageUri: string,
    base64?: string,
): Promise<WasteClassificationResult> => {
    if (!base64) {
        throw new Error('Base64 görüntü verisi gereklidir.');
    }

    try {
        // 1. Load model (cached after first call)
        const loadedModel = await getModel();

        // 2. Decode JPEG and preprocess pixels
        console.log('[WasteClassifier] Preprocessing image...');
        const inputData = decodeAndPreprocess(base64);

        // 3. Run inference
        console.log('[WasteClassifier] Running inference...');
        // react-native-fast-tflite v3+ expects ArrayBuffer[], not TypedArray[]
        const output = await loadedModel.run([inputData.buffer]);
        
        // Output is an ArrayBuffer, convert it to Float32Array
        const outputArray = new Float32Array(output[0]);

        // 4. Convert to probabilities (softmax if needed)
        let probabilities: number[];
        const sum = Array.from(outputArray).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1.0) > 0.1) {
            probabilities = softmax(outputArray);
        } else {
            probabilities = Array.from(outputArray);
        }

        // 5. Get top prediction
        const topIdx = argmax(probabilities);
        const confidence = probabilities[topIdx];
        const label = labels[topIdx] || 'trash';

        console.log('[WasteClassifier] Results:', labels.map((l, i) =>
            `${l}: ${(probabilities[i] * 100).toFixed(1)}%`
        ).join(', '));

        return {
            type: labelDisplayNames[label] || label,
            binColor: binColors[label] || '#808080',
            description: descriptions[label] || 'Analiz sonucu alınamadı.',
            confidence,
        };
    } catch (error: any) {
        console.error('[WasteClassifier] Error:', error);
        throw new Error('Atık analizi yapılamadı. Lütfen tekrar deneyin.');
    }
};