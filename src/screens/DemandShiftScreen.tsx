import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Alert,
    StyleSheet,
    SafeAreaView,
    ActivityIndicator,
    RefreshControl,
} from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/Colors';
import { RootStackParamList, DemandShiftRecommendation } from '../types/navigation';
import { useAuth } from '../contexts/AuthContext';
import { demandShiftService, userProfileService } from '../services/supabaseService';

type DemandShiftScreenNavigationProp = StackNavigationProp<RootStackParamList, 'DemandShift'>;

interface DemandShiftScreenProps {
    navigation: DemandShiftScreenNavigationProp;
}

const DemandShiftScreen: React.FC<DemandShiftScreenProps> = ({ navigation }) => {
    const { user } = useAuth();
    const [recommendations, setRecommendations] = useState<DemandShiftRecommendation[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState({
        pending: 0,
        approved: 0,
        totalSavings: 0,
        totalCO2: 0,
    });

    const [companyId, setCompanyId] = useState<string>(user?.user_metadata?.company_id || '');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);

            if (!user?.id) {
                Alert.alert('Hata', 'Kullanıcı bilgisi bulunamadı.');
                return;
            }

            // Kullanıcının company_id'sini belirle (metadata yoksa user_profiles tablosundan al)
            let effectiveCompanyId = companyId;
            if (!effectiveCompanyId) {
                try {
                    const profile = await userProfileService.getUserProfile(user.id);
                    if (profile?.company_id) {
                        effectiveCompanyId = profile.company_id;
                        setCompanyId(effectiveCompanyId);
                    } else {
                        Alert.alert('Hata', 'Şirket bilgisi bulunamadı.');
                        return;
                    }
                } catch (err) {
                    console.error('Profil alınırken hata:', err);
                    Alert.alert('Hata', 'Kullanıcı profili alınamadı.');
                    return;
                }
            }

            // Önerileri oluştur
            const newRecommendations = await demandShiftService.generateDemandShiftRecommendations(
                user.id,
                effectiveCompanyId as string
            );

            // Eğer yeni öneriler varsa kaydet
            if (newRecommendations.length > 0) {
                await demandShiftService.saveDemandShiftRecommendations(newRecommendations);
            }

            // Tüm önerileri getir
            const allRecommendations = await demandShiftService.getUserRecommendations(user.id);
            setRecommendations(allRecommendations);

            // İstatistikleri hesapla
            const pending = allRecommendations.filter(r => r.status === 'pending').length;
            const approved = allRecommendations.filter(r => r.status === 'approved').length;
            const totalSavings = allRecommendations.reduce(
                (sum, r) => sum + (r.potential_savings_tl || 0),
                0
            );
            const totalCO2 = allRecommendations.reduce(
                (sum, r) => sum + (r.co2_reduction_kg || 0),
                0
            );

            setStats({ pending, approved, totalSavings, totalCO2 });
        } catch (error) {
            console.error('Veri yükleme hatası:', error);
            Alert.alert('Hata', 'Öneriler yüklenirken bir hata oluştu.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = () => {
        setRefreshing(true);
        loadData();
    };

    const handleApprove = async (recommendationId: string) => {
        try {
            await demandShiftService.approveRecommendation(recommendationId, true);
            Alert.alert('Başarılı', 'Öneri onaylandı! ✅', [
                {
                    text: 'Tamam',
                    onPress: loadData,
                },
            ]);
        } catch (error) {
            Alert.alert('Hata', 'Onaylama işlemi başarısız oldu.');
        }
    };

    const handleReject = async (recommendationId: string) => {
        try {
            await demandShiftService.approveRecommendation(recommendationId, false);
            Alert.alert('Başarılı', 'Öneri reddedildi.', [
                {
                    text: 'Tamam',
                    onPress: loadData,
                },
            ]);
        } catch (error) {
            Alert.alert('Hata', 'Reddetme işlemi başarısız oldu.');
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.loadingText}>Öneriler yükleniyor...</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>

                {/* İstatistik Kartları */}
                <View style={styles.statsContainer}>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{stats.pending}</Text>
                        <Text style={styles.statLabel}>Bekleyen</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{stats.approved}</Text>
                        <Text style={styles.statLabel}>Onaylı</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{stats.totalSavings.toFixed(0)}</Text>
                        <Text style={styles.statLabel}>Tasarruf (₺)</Text>
                    </View>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{stats.totalCO2.toFixed(0)}</Text>
                        <Text style={styles.statLabel}>CO2 (kg)</Text>
                    </View>
                </View>

                {/* Öneriler Listesi */}
                {recommendations.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateIcon}>🎉</Text>
                        <Text style={styles.emptyStateText}>Hiç öneri yok</Text>
                        <Text style={styles.emptyStateSubtext}>
                            Tüm taleplerin zaten optimum saatlerde.
                        </Text>
                    </View>
                ) : (
                    <View style={styles.recommendationsContainer}>
                        {recommendations.map((rec) => (
                            <View key={rec.id} style={styles.recommendationCard}>
                                {/* Başlık */}
                                <View style={styles.cardHeader}>
                                    <View style={styles.titleSection}>
                                        <Text style={styles.cardTitle}>{rec.reason}</Text>
                                    </View>
                                    <View
                                        style={[
                                            styles.statusBadge,
                                            {
                                                backgroundColor:
                                                    rec.status === 'pending'
                                                        ? Colors.pending
                                                        : rec.status === 'approved'
                                                            ? Colors.approved
                                                            : Colors.rejected,
                                            },
                                        ]}>
                                        <Text style={styles.statusText}>{rec.status}</Text>
                                    </View>
                                </View>

                                {/* Detaylar */}
                                <View style={styles.detailsSection}>
                                    {/* Saat Değişimi */}
                                    <View style={styles.timeShift}>
                                        <View style={styles.timeBox}>
                                            <Text style={styles.timeLabel}>Orijinal Saat</Text>
                                            <Text style={styles.timeValue}>{rec.original_hour}</Text>
                                        </View>
                                        <View style={styles.arrowBox}>
                                            <Text style={styles.arrow}>→</Text>
                                        </View>
                                        <View style={styles.timeBox}>
                                            <Text style={styles.timeLabel}>Önerilen Saat</Text>
                                            <Text style={styles.timeValue}>{rec.recommended_hour}</Text>
                                        </View>
                                    </View>

                                    {/* Metrikler */}
                                    <View style={styles.metricsGrid}>
                                        <View style={styles.metricItem}>
                                            <Text style={styles.metricLabel}>Yük</Text>
                                            <Text style={styles.metricValue}>{rec.original_load_kwh.toFixed(1)}</Text>
                                            <Text style={styles.metricUnit}>kWh</Text>
                                        </View>
                                        <View style={styles.metricItem}>
                                            <Text style={styles.metricLabel}>Tasarruf</Text>
                                            <Text style={[styles.metricValue, { color: Colors.approved }]}>
                                                {rec.potential_savings_tl.toFixed(2)}
                                            </Text>
                                            <Text style={styles.metricUnit}>₺</Text>
                                        </View>
                                        <View style={styles.metricItem}>
                                            <Text style={styles.metricLabel}>CO2 Azaltım</Text>
                                            <Text style={[styles.metricValue, { color: Colors.offPeak || '#2196F3' }]}>
                                                {rec.co2_reduction_kg.toFixed(1)}
                                            </Text>
                                            <Text style={styles.metricUnit}>kg</Text>
                                        </View>
                                    </View>

                                    {/* Tarih */}
                                    <Text style={styles.dateText}>
                                        📅 {new Date(rec.created_at).toLocaleDateString('tr-TR')}
                                    </Text>
                                </View>

                                {/* Action Buttons */}
                                {rec.status === 'pending' && (
                                    <View style={styles.actionButtons}>
                                        <TouchableOpacity
                                            style={[styles.button, styles.approveBtn]}
                                            onPress={() => handleApprove(rec.id)}>
                                            <Text style={styles.buttonText}>✅ Onayla</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.button, styles.rejectBtn]}
                                            onPress={() => handleReject(rec.id)}>
                                            <Text style={styles.buttonText}>❌ Reddet</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: Colors.background,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: Colors.background,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: Colors.textDark,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        backgroundColor: Colors.primary,
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: Colors.white,
    },
    subtitle: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.8)',
        marginTop: 4,
    },
    backButton: {
        padding: 8,
    },
    backButtonText: {
        color: Colors.white,
        fontSize: 14,
        fontWeight: 'bold',
    },
    statsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        padding: 12,
        gap: 10,
    },
    statCard: {
        flex: 1,
        minWidth: '48%',
        backgroundColor: Colors.white,
        borderRadius: 12,
        padding: 12,
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    statValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: Colors.primary,
    },
    statLabel: {
        fontSize: 12,
        color: Colors.textDark,
        marginTop: 4,
    },
    recommendationsContainer: {
        paddingHorizontal: 12,
        paddingBottom: 20,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    emptyStateIcon: {
        fontSize: 48,
        marginBottom: 12,
    },
    emptyStateText: {
        fontSize: 18,
        fontWeight: 'bold',
        color: Colors.textDark,
    },
    emptyStateSubtext: {
        fontSize: 14,
        color: Colors.secondary,
        marginTop: 8,
    },
    recommendationCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    titleSection: {
        flex: 1,
    },
    cardTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: Colors.textDark,
        marginRight: 8,
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: Colors.white,
        fontSize: 11,
        fontWeight: 'bold',
    },
    detailsSection: {
        gap: 12,
    },
    timeShift: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: Colors.inputBackground,
        borderRadius: 8,
        padding: 12,
    },
    timeBox: {
        flex: 1,
        alignItems: 'center',
    },
    timeLabel: {
        fontSize: 11,
        color: Colors.secondary,
        marginBottom: 4,
    },
    timeValue: {
        fontSize: 14,
        fontWeight: 'bold',
        color: Colors.primary,
    },
    arrowBox: {
        alignItems: 'center',
        marginHorizontal: 8,
    },
    arrow: {
        fontSize: 18,
        color: Colors.primary,
    },
    metricsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: Colors.priceBackground || '#f0f0f0',
        borderRadius: 8,
        paddingVertical: 12,
    },
    metricItem: {
        alignItems: 'center',
    },
    metricLabel: {
        fontSize: 10,
        color: Colors.secondary,
        marginBottom: 2,
    },
    metricValue: {
        fontSize: 16,
        fontWeight: 'bold',
        color: Colors.primary,
    },
    metricUnit: {
        fontSize: 9,
        color: Colors.secondary,
        marginTop: 2,
    },
    dateText: {
        fontSize: 12,
        color: Colors.secondary,
        marginTop: 4,
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 12,
    },
    button: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    approveBtn: {
        backgroundColor: Colors.approved,
    },
    rejectBtn: {
        backgroundColor: Colors.rejected,
    },
    buttonText: {
        color: Colors.white,
        fontWeight: 'bold',
        fontSize: 14,
    },
});

export default DemandShiftScreen;
