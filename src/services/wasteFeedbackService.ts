import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import { supabase } from '../lib/supabase';
import { WasteLabelKey } from './WasteClassifier';

export const FEEDBACK_CONFIDENCE_THRESHOLD = 0.6;
export const FEEDBACK_SAMPLING_RATE = 0.2;
export const FEEDBACK_QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MODEL_DEPLOYMENT_TAG = 'v0.0.1-tflite-fp32';

const FEEDBACK_QUEUE_KEY = 'waste_feedback_queue_v1';
const FEEDBACK_CONSENT_KEY = 'waste_feedback_image_consent_v1';
const FEEDBACK_BUCKET = 'waste-feedback-images';
const FEEDBACK_BATCH_SIZE = 10;

const uuidv4 = (): string =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const rand = Math.floor(Math.random() * 16);
        const value = char === 'x' ? rand : (rand & 0x3) | 0x8;
        return value.toString(16);
    });

const isValidUuid = (value: string): boolean =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const normalizeQueue = (items: WasteFeedbackQueueItem[]): { items: WasteFeedbackQueueItem[]; changed: boolean } => {
    let changed = false;
    const normalized = items.reduce<WasteFeedbackQueueItem[]>((acc, item) => {
        if (!item?.userId) {
            changed = true;
            return acc;
        }

        if (!isValidUuid(item.id)) {
            changed = true;
            acc.push({ ...item, id: uuidv4() });
            return acc;
        }

        acc.push(item);
        return acc;
    }, []);

    return { items: normalized, changed };
};

export interface WasteFeedbackQueueItem {
    id: string;
    userId: string;
    createdAt: string;
    platform: string;
    appVersion?: string;
    modelVersion: string;
    predictedLabelKey: WasteLabelKey;
    predictedConfidence: number;
    predictedScores?: Record<WasteLabelKey, number>;
    isCorrect: boolean;
    correctLabelKey?: WasteLabelKey;
    consentImageUpload: boolean;
    imageBase64?: string;
}

export const shouldShowFeedback = (confidence: number): boolean => {
    if (confidence < FEEDBACK_CONFIDENCE_THRESHOLD) {
        return true;
    }
    return Math.random() < FEEDBACK_SAMPLING_RATE;
};

export const getStoredImageConsent = async (): Promise<boolean | null> => {
    const value = await AsyncStorage.getItem(FEEDBACK_CONSENT_KEY);
    if (value === null) {
        return null;
    }
    return value === 'true';
};

export const setStoredImageConsent = async (value: boolean): Promise<void> => {
    await AsyncStorage.setItem(FEEDBACK_CONSENT_KEY, value ? 'true' : 'false');
};

const loadQueue = async (): Promise<WasteFeedbackQueueItem[]> => {
    const raw = await AsyncStorage.getItem(FEEDBACK_QUEUE_KEY);
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as WasteFeedbackQueueItem[];
        const list = Array.isArray(parsed) ? parsed : [];
        const normalized = normalizeQueue(list);
        if (normalized.changed) {
            await saveQueue(normalized.items);
        }
        return normalized.items;
    } catch {
        return [];
    }
};

const saveQueue = async (queue: WasteFeedbackQueueItem[]): Promise<void> => {
    await AsyncStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(queue));
};

const isExpired = (item: WasteFeedbackQueueItem): boolean => {
    const created = new Date(item.createdAt).getTime();
    return Number.isNaN(created) || Date.now() - created > FEEDBACK_QUEUE_TTL_MS;
};

const pruneQueue = (queue: WasteFeedbackQueueItem[]): WasteFeedbackQueueItem[] =>
    queue.filter((item) => !isExpired(item));

const buildImagePath = (item: WasteFeedbackQueueItem): string => {
    const datePart = item.createdAt.split('T')[0] || 'unknown-date';
    return `${item.userId}/${datePart}/${item.id}.jpg`;
};

const uploadImageIfNeeded = async (item: WasteFeedbackQueueItem): Promise<string | null> => {
    if (item.isCorrect || !item.consentImageUpload || !item.imageBase64) {
        return null;
    }

    const normalizedBase64 = item.imageBase64.trim().replace(/^data:.*;base64,/, '');
    const buffer = Buffer.from(normalizedBase64, 'base64');
    const imagePath = buildImagePath(item);

    const { error } = await supabase.storage.from(FEEDBACK_BUCKET).upload(
        imagePath,
        buffer,
        { contentType: 'image/jpeg', upsert: false }
    );

    if (error) {
        console.error('[WasteFeedback] Upload failed:', error);
        return null;
    }

    return imagePath;
};

const upsertFeedbackRow = async (
    item: WasteFeedbackQueueItem,
    imagePath: string | null,
): Promise<boolean> => {
    const payload = {
        id: item.id,
        user_id: item.userId,
        created_at: item.createdAt,
        platform: item.platform,
        app_version: item.appVersion || null,
        model_version: item.modelVersion,
        predicted_label_key: item.predictedLabelKey,
        predicted_confidence: item.predictedConfidence,
        predicted_scores: item.predictedScores || null,
        is_correct: item.isCorrect,
        correct_label_key: item.correctLabelKey || null,
        consent_image_upload: item.consentImageUpload,
        image_path: imagePath,
        image_sha256: null,
    };

    const { error } = await supabase
        .from('waste_classification_feedback')
        .upsert(payload, { onConflict: 'id' });

    if (error) {
        console.error('[WasteFeedback] Upsert failed:', error);
        return false;
    }

    return true;
};

export const enqueueFeedback = async (item: WasteFeedbackQueueItem): Promise<void> => {
    const queue = await loadQueue();
    const pruned = pruneQueue(queue);
    pruned.push(item);
    await saveQueue(pruned);
};

export const flushFeedbackQueue = async (userId: string): Promise<{ sent: number; remaining: number }> => {
    const queue = await loadQueue();
    const pruned = pruneQueue(queue);

    const ownItems = pruned.filter((item) => item.userId === userId);
    const otherItems = pruned.filter((item) => item.userId !== userId);

    const toSend = ownItems.slice(0, FEEDBACK_BATCH_SIZE);
    const remainingOwn = ownItems.slice(FEEDBACK_BATCH_SIZE);

    const failed: WasteFeedbackQueueItem[] = [];
    let sent = 0;

    for (const item of toSend) {
        try {
            const imagePath = await uploadImageIfNeeded(item);
            const ok = await upsertFeedbackRow(item, imagePath);
            if (ok) {
                sent += 1;
            } else {
                failed.push(item);
            }
        } catch (error) {
            console.error('[WasteFeedback] Flush error:', error);
            failed.push(item);
        }
    }

    const newQueue = [...otherItems, ...remainingOwn, ...failed];
    await saveQueue(newQueue);

    return { sent, remaining: newQueue.length };
};

export const buildFeedbackItem = (params: {
    userId: string;
    predictedLabelKey: WasteLabelKey;
    predictedConfidence: number;
    predictedScores?: Record<WasteLabelKey, number>;
    isCorrect: boolean;
    correctLabelKey?: WasteLabelKey;
    consentImageUpload: boolean;
    imageBase64?: string;
    appVersion?: string;
}): WasteFeedbackQueueItem => ({
    id: uuidv4(),
    userId: params.userId,
    createdAt: new Date().toISOString(),
    platform: Platform.OS,
    appVersion: params.appVersion,
    modelVersion: MODEL_DEPLOYMENT_TAG,
    predictedLabelKey: params.predictedLabelKey,
    predictedConfidence: params.predictedConfidence,
    predictedScores: params.predictedScores,
    isCorrect: params.isCorrect,
    correctLabelKey: params.correctLabelKey,
    consentImageUpload: params.consentImageUpload,
    imageBase64: params.imageBase64,
});
