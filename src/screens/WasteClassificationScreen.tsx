import React, { useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Image,
    ScrollView,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types/navigation';
import { Colors } from '../constants/Colors';
import {
    classifyImage,
    WasteClassificationResult,
    WASTE_LABELS,
    WASTE_LABEL_DISPLAY_NAMES,
    WasteLabelKey,
} from '../services/WasteClassifier';
import { useAuth } from '../contexts/AuthContext';
import { greenPointsService, POINTS_VALUES } from '../services/greenPointsService';
import {
    buildFeedbackItem,
    enqueueFeedback,
    flushFeedbackQueue,
    getStoredImageConsent,
    setStoredImageConsent,
    shouldShowFeedback,
} from '../services/wasteFeedbackService';

type WasteClassificationScreenNavigationProp = StackNavigationProp<RootStackParamList, 'WasteClassification'>;

interface Props {
    navigation: WasteClassificationScreenNavigationProp;
}

const WasteClassificationScreen: React.FC<Props> = ({ navigation }) => {
    const { user } = useAuth();
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [result, setResult] = useState<WasteClassificationResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [base64Image, setBase64Image] = useState<string | undefined>(undefined);
    const [imageMimeType, setImageMimeType] = useState<string | undefined>(undefined);
    const [pointsEarned, setPointsEarned] = useState<number | null>(null);
    const [showFeedback, setShowFeedback] = useState(false);
    const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
    const [showCorrectionOptions, setShowCorrectionOptions] = useState(false);
    const [sendingFeedback, setSendingFeedback] = useState(false);

    useEffect(() => {
        if (!user?.id) {
            return;
        }

        flushFeedbackQueue(user.id).catch((error) => {
            console.log('Feedback flush failed:', error);
        });
    }, [user?.id]);

    const handleImageSelection = async (type: 'camera' | 'gallery') => {
        const options = {
            mediaType: 'photo' as const,
            includeBase64: true,
            maxHeight: 1024,
            maxWidth: 1024,
            quality: 0.8 as 0.8,
        };

        try {
            const response = type === 'camera'
                ? await launchCamera(options)
                : await launchImageLibrary(options);

            if (response.didCancel) {
                return;
            }

            if (response.errorCode) {
                Alert.alert('Hata', response.errorMessage || 'Resim seçilirken bir hata oluştu');
                return;
            }

            const asset = response.assets?.[0];
            if (asset?.uri) {
                setSelectedImage(asset.uri);
                setBase64Image(asset.base64);
                setImageMimeType(asset.type);
                setResult(null);
            } else {
                setImageMimeType(undefined);
                setShowFeedback(false);
                setFeedbackSubmitted(false);
                setShowCorrectionOptions(false);
            }
        } catch (error) {
            Alert.alert('Hata', 'Beklenmeyen bir hata oluştu');
        }
    };

    const requestImageConsent = async (): Promise<boolean> => {
        const stored = await getStoredImageConsent();
        if (stored !== null) {
            return stored;
        }

        return new Promise((resolve) => {
            Alert.alert(
                'Fotoğraf Paylaşımı',
                'Yanlış tahminleri iyileştirmek için fotoğrafınızı paylaşabilir misiniz?',
                [
                    {
                        text: 'Hayır',
                        style: 'cancel',
                        onPress: () => {
                            setStoredImageConsent(false).catch(() => undefined);
                            resolve(false);
                        },
                    },
                    {
                        text: 'Evet',
                        onPress: () => {
                            setStoredImageConsent(true).catch(() => undefined);
                            resolve(true);
                        },
                    },
                ],
                {
                    cancelable: true,
                    onDismiss: () => {
                        setStoredImageConsent(false).catch(() => undefined);
                        resolve(false);
                    },
                }
            );
        });
    };

    const submitFeedback = async (isCorrect: boolean, correctLabelKey?: WasteLabelKey) => {
        if (!user?.id || !result) {
            return;
        }

        setSendingFeedback(true);
        try {
            const consentImageUpload = isCorrect ? false : await requestImageConsent();
            const item = buildFeedbackItem({
                userId: user.id,
                predictedLabelKey: result.labelKey,
                predictedConfidence: result.confidence,
                predictedScores: result.probabilities,
                isCorrect,
                correctLabelKey,
                consentImageUpload,
                imageBase64: !isCorrect && consentImageUpload ? base64Image : undefined,
            });

            await enqueueFeedback(item);
            await flushFeedbackQueue(user.id);

            setFeedbackSubmitted(true);
            setShowFeedback(false);
            setShowCorrectionOptions(false);
        } catch (error) {
            Alert.alert('Hata', 'Geri bildirim kaydedilemedi. Daha sonra tekrar deneyin.');
        } finally {
            setSendingFeedback(false);
        }
    };

    const handleAnalyze = async () => {
        if (!selectedImage) {
            Alert.alert('Hata', 'Resim verisi bulunamadı.');
            return;
        }

        setLoading(true);
        setPointsEarned(null);
        try {
            const classificationResult = await classifyImage(selectedImage, base64Image, imageMimeType);
            setResult(classificationResult);
            setShowFeedback(shouldShowFeedback(classificationResult.confidence));
            setFeedbackSubmitted(false);
            setShowCorrectionOptions(false);

            // Başarılı sınıflandırma için yeşil puan ekle
            if (user?.id && classificationResult.type !== 'Unknown') {
                try {
                    await greenPointsService.addWasteClassificationPoints(user.id, classificationResult.type);
                    setPointsEarned(POINTS_VALUES.WASTE_CLASSIFICATION);
                } catch (pointsError) {
                    console.log('Puan eklenemedi:', pointsError);
                }
            }
        } catch (error: any) {
            Alert.alert('Hata', error.message || 'Analiz sırasında bir hata oluştu');
        } finally {
            setLoading(false);
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Atık Ayrıştırma Asistanı</Text>
                <Text style={styles.subtitle}>
                    Atığınızı doğru kutuya atmak için fotoğrafını çekin veya yükleyin.
                </Text>
            </View>

            <View style={styles.imageContainer}>
                {selectedImage ? (
                    <Image source={{ uri: selectedImage }} style={styles.previewImage} />
                ) : (
                    <View style={styles.placeholderContainer}>
                        <Text style={styles.placeholderText}>Fotoğraf yok</Text>
                    </View>
                )}
            </View>

            <View style={styles.buttonContainer}>
                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleImageSelection('camera')}>
                    <Text style={styles.buttonText}>📷 Fotoğraf Çek</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => handleImageSelection('gallery')}>
                    <Text style={styles.buttonText}>🖼️ Galeriden Seç</Text>
                </TouchableOpacity>
            </View>

            {selectedImage && !result && (
                <TouchableOpacity
                    style={[styles.analyzeButton, loading && styles.disabledButton]}
                    onPress={handleAnalyze}
                    disabled={loading}>
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.analyzeButtonText}>Analiz Et 🔍</Text>
                    )}
                </TouchableOpacity>
            )}

            {result && (
                <View style={styles.resultContainer}>
                    <View style={[styles.resultHeader, { backgroundColor: result.binColor }]}>
                        <Text style={styles.resultTitle}>{result.type}</Text>
                    </View>
                    <View style={styles.resultBody}>
                        <Text style={styles.resultDescription}>{result.description}</Text>
                        <Text style={styles.confidenceText}>
                            Güven Oranı: %{(result.confidence * 100).toFixed(0)}
                        </Text>
                        {pointsEarned && (
                            <View style={styles.pointsEarnedBadge}>
                                <Text style={styles.pointsEarnedText}>+{pointsEarned} Yeşil Puan Kazandın! 🌱</Text>
                            </View>
                        )}
                        {showFeedback && !feedbackSubmitted && (
                            <View style={styles.feedbackContainer}>
                                <Text style={styles.feedbackPrompt}>Sonuç doğru mu?</Text>
                                <View style={styles.feedbackButtons}>
                                    <TouchableOpacity
                                        style={[styles.feedbackButton, styles.feedbackPositive]}
                                        onPress={() => submitFeedback(true)}
                                        disabled={sendingFeedback}>
                                        <Text style={styles.feedbackButtonText}>👍 Doğru</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.feedbackButton, styles.feedbackNegative]}
                                        onPress={() => setShowCorrectionOptions(true)}
                                        disabled={sendingFeedback}>
                                        <Text style={styles.feedbackButtonText}>👎 Yanlış</Text>
                                    </TouchableOpacity>
                                </View>
                                {showCorrectionOptions && (
                                    <View style={styles.correctionContainer}>
                                        <Text style={styles.correctionPrompt}>Doğru sınıfı seçin</Text>
                                        <View style={styles.correctionGrid}>
                                            {WASTE_LABELS.map((labelKey) => (
                                                <TouchableOpacity
                                                    key={labelKey}
                                                    style={styles.correctionOption}
                                                    onPress={() => submitFeedback(false, labelKey)}
                                                    disabled={sendingFeedback}>
                                                    <Text style={styles.correctionOptionText}>
                                                        {WASTE_LABEL_DISPLAY_NAMES[labelKey]}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                )}
                            </View>
                        )}
                        {feedbackSubmitted && (
                            <Text style={styles.feedbackThanks}>Geri bildirimin kaydedildi. Teşekkürler!</Text>
                        )}
                    </View>
                </View>
            )}
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    container: {
        flexGrow: 1,
        padding: 20,
        backgroundColor: Colors.background,
    },
    header: {
        marginBottom: 20,
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: Colors.primary,
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 16,
        color: Colors.secondary,
        textAlign: 'center',
    },
    imageContainer: {
        width: '100%',
        height: 300,
        backgroundColor: '#f0f0f0',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        marginBottom: 20,
        borderWidth: 2,
        borderColor: '#e0e0e0',
    },
    previewImage: {
        width: '100%',
        height: '100%',
        resizeMode: 'cover',
    },
    placeholderContainer: {
        alignItems: 'center',
    },
    placeholderText: {
        color: '#888',
        fontSize: 16,
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    actionButton: {
        flex: 0.48,
        backgroundColor: 'white',
        padding: 15,
        borderRadius: 10,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
        elevation: 3,
    },
    buttonText: {
        color: Colors.textDark,
        fontWeight: '600',
    },
    analyzeButton: {
        backgroundColor: Colors.primary,
        padding: 18,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 20,
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 6,
    },
    disabledButton: {
        opacity: 0.7,
    },
    analyzeButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    resultContainer: {
        backgroundColor: 'white',
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 4,
    },
    resultHeader: {
        padding: 16,
        alignItems: 'center',
    },
    resultTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: 'white',
        textShadowColor: 'rgba(0,0,0,0.3)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    resultBody: {
        padding: 20,
    },
    resultDescription: {
        fontSize: 16,
        color: Colors.textDark,
        lineHeight: 24,
        marginBottom: 12,
    },
    confidenceText: {
        fontSize: 14,
        color: Colors.secondary,
        fontStyle: 'italic',
        textAlign: 'right',
    },
    pointsEarnedBadge: {
        backgroundColor: Colors.primary,
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderRadius: 20,
        marginTop: 15,
        alignSelf: 'center',
    },
    pointsEarnedText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    feedbackContainer: {
        marginTop: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: Colors.border,
    },
    feedbackPrompt: {
        fontSize: 15,
        fontWeight: '600',
        color: Colors.textDark,
        marginBottom: 8,
    },
    feedbackButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    feedbackButton: {
        flex: 0.48,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
    },
    feedbackPositive: {
        backgroundColor: Colors.approved,
    },
    feedbackNegative: {
        backgroundColor: Colors.rejected,
    },
    feedbackButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    correctionContainer: {
        marginTop: 12,
    },
    correctionPrompt: {
        fontSize: 14,
        color: Colors.secondary,
        marginBottom: 8,
    },
    correctionGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    correctionOption: {
        backgroundColor: Colors.inputBackground,
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: Colors.border,
        marginRight: 8,
        marginBottom: 8,
    },
    correctionOptionText: {
        color: Colors.textDark,
        fontSize: 13,
        fontWeight: '600',
    },
    feedbackThanks: {
        marginTop: 12,
        color: Colors.primary,
        fontWeight: '600',
        textAlign: 'center',
    },
});

export default WasteClassificationScreen;
