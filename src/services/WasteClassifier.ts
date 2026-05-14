import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Buffer } from 'buffer';
import * as jpeg from 'jpeg-js';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import RNFS from 'react-native-fs';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (!g.Buffer) {
    g.Buffer = Buffer;
}

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
const JPEG_MIME_TYPES = new Set(['image/jpeg', 'image/jpg']);

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

function normalizeBase64(base64: string): string {
    return base64.trim().replace(/^data:.*;base64,/, '');
}

function looksLikeJpeg(base64: string): boolean {
    const normalized = normalizeBase64(base64);
    return normalized.startsWith('/9j/');
}

function stripFileScheme(uri: string): string {
    return uri.startsWith('file://') ? uri.slice(7) : uri;
}

async function ensureJpegBase64(
    imageUri: string,
    base64?: string,
    mimeType?: string,
): Promise<string> {
    const normalizedMime = mimeType?.toLowerCase();
    const isJpegMime = normalizedMime ? JPEG_MIME_TYPES.has(normalizedMime) : false;

    if (base64 && (isJpegMime || looksLikeJpeg(base64))) {
        return base64;
    }

    if (!imageUri) {
        throw new Error('Görsel yolu bulunamadı. Lütfen tekrar seçin.');
    }

    try {
        console.log('[WasteClassifier] Converting image to JPEG for model input...');
        const resized = await ImageResizer.createResizedImage(
            imageUri,
            IMG_SIZE,
            IMG_SIZE,
            'JPEG',
            92
        );
        const fileUri = resized?.uri ?? resized?.path;
        if (!fileUri) {
            throw new Error('Dönüştürülen görsel bulunamadı.');
        }
        const filePath = stripFileScheme(fileUri);
        return await RNFS.readFile(filePath, 'base64');
    } catch (err) {
        console.error('[WasteClassifier] JPEG conversion failed:', err);
        throw new Error('Görsel formatı desteklenmiyor veya dönüştürülemedi. Lütfen JPEG/PNG/WEBP kullanın.');
    }
}

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
 * of raw RGB values in [0..255].
 *
 * Note: The exported model (see train_and_convert_example.py) already contains
 * `keras.applications.mobilenet_v2.preprocess_input`, so we must NOT apply it twice.
 */
function decodeAndPreprocess(base64: string): Float32Array {
    // 1. Decode base64 → raw JPEG bytes
    const normalizedBase64 = normalizeBase64(base64);
    let rawImage:
        | {
              width: number;
              height: number;
              data: Uint8Array;
          }
        | undefined;

    try {
        const jpegBuffer = Buffer.from(normalizedBase64, 'base64');
        // 2. Decode JPEG → RGBA pixel data
        rawImage = (jpeg as any).decode(jpegBuffer, { useTArray: true, formatAsRGBA: true });
    } catch (err) {
        console.error('[WasteClassifier] JPEG decode failed:', err);
        throw new Error('JPEG çözümleme başarısız. Lütfen farklı bir fotoğraf deneyin.');
    }

    if (!rawImage?.data) {
        throw new Error('JPEG çözümleme başarısız. Lütfen farklı bir fotoğraf deneyin.');
    }
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

            // Keep raw [0..255] RGB. Model handles MobileNetV2 preprocessing internally.
            float32[dstIdx]     = rgbaPixels[srcIdx];     // R
            float32[dstIdx + 1] = rgbaPixels[srcIdx + 1]; // G
            float32[dstIdx + 2] = rgbaPixels[srcIdx + 2]; // B
        }
    }

    return float32;
}

/**
 * Ensure a plain ArrayBuffer for native bridge APIs.
 */
function toArrayBuffer(view: ArrayBufferView): ArrayBuffer {
    const buffer = view.buffer;
    if (buffer instanceof ArrayBuffer) {
        if (view.byteOffset === 0 && view.byteLength === buffer.byteLength) {
            return buffer;
        }
        return buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }

    const copy = new ArrayBuffer(view.byteLength);
    new Uint8Array(copy).set(new Uint8Array(buffer, view.byteOffset, view.byteLength));
    return copy;
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
 * @param imageUri  - URI of the image (used for conversion when base64 is not JPEG)
 * @param base64    - Base64 image data (JPEG/PNG/WEBP supported; converted to JPEG if needed)
 * @param mimeType  - Optional MIME type from picker
 */
export const classifyImage = async (
    imageUri: string,
    base64?: string,
    mimeType?: string,
): Promise<WasteClassificationResult> => {
    try {
        // 1. Load model (cached after first call)
        const loadedModel = await getModel();

        // 2. Decode JPEG and preprocess pixels
        console.log('[WasteClassifier] Preprocessing image...');
        const jpegBase64 = await ensureJpegBase64(imageUri, base64, mimeType);
        const inputData = decodeAndPreprocess(jpegBase64);

        // 3. Run inference
        console.log('[WasteClassifier] Running inference...');
        // react-native-fast-tflite v3+ expects ArrayBuffer[], not TypedArray[]
        const inputTensor = loadedModel.inputs?.[0];
        const inputDataType = inputTensor?.dataType;

        let inputBuffer: ArrayBuffer;
        if (inputDataType === 'uint8') {
            const uint8 = new Uint8Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const v = Math.round(inputData[i]);
                uint8[i] = v < 0 ? 0 : v > 255 ? 255 : v;
            }
            inputBuffer = toArrayBuffer(uint8);
        } else {
            // Default: float32 model input.
            inputBuffer = toArrayBuffer(inputData);
        }

        const output = await loadedModel.run([inputBuffer]);
        
        const outputTensor = loadedModel.outputs?.[0];
        const outputDataType = outputTensor?.dataType;

        // Output is an ArrayBuffer; decode based on reported dtype.
        let scores: number[];
        if (outputDataType === 'uint8') {
            scores = Array.from(new Uint8Array(output[0]));
        } else if (outputDataType === 'int8') {
            scores = Array.from(new Int8Array(output[0]));
        } else {
            scores = Array.from(new Float32Array(output[0]));
        }

        // 4. Convert to probabilities (softmax if needed)
        let probabilities: number[];
        const sum = scores.reduce((a, b) => a + b, 0);
        const looksLikeProbabilities = scores.every(v => v >= 0 && v <= 1) && Math.abs(sum - 1.0) <= 0.05;
        probabilities = looksLikeProbabilities ? scores : softmax(scores);

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
        const message = error instanceof Error && error.message
            ? error.message
            : 'Atık analizi yapılamadı. Lütfen tekrar deneyin.';
        throw new Error(message);
    }
};