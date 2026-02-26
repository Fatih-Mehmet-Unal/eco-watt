import { supabase } from '../lib/supabase';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_KEY } from '@env';
import { greenPointsService, POINTS_VALUES } from './greenPointsService';

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Types
export interface EcoTip {
    id: string;
    title: string;
    description: string;
    category: 'water' | 'energy' | 'waste' | 'transport' | 'food' | 'general';
    icon: string;
}

export interface HabitCheckIn {
    id: string;
    user_id: string;
    habit_type: string;
    checked_at: string;
}

export interface EcoChallenge {
    id: string;
    title: string;
    description: string;
    target_count: number;
    current_count: number;
    points_reward: number;
    deadline: string;
    completed: boolean;
}

// Eco tips pool
const ECO_TIPS_POOL: EcoTip[] = [
    // Su tasarrufu
    { id: '1', title: 'Duş Süresini Kısalt', description: 'Duş sürenizi 2 dakika kısaltarak yılda 3.000 litre su tasarrufu yapabilirsiniz.', category: 'water', icon: '🚿' },
    { id: '2', title: 'Musluk Kontrolü', description: 'Damlayan bir musluk günde 20 litre su israf eder. Musluklarınızı kontrol edin.', category: 'water', icon: '💧' },
    { id: '3', title: 'Bulaşık Makinesi', description: 'Elle yıkamak yerine bulaşık makinesi kullanmak %75 daha az su harcar.', category: 'water', icon: '🍽️' },

    // Enerji tasarrufu
    { id: '4', title: 'LED Ampul', description: 'LED ampuller normal ampullerden %80 daha az enerji harcar.', category: 'energy', icon: '💡' },
    { id: '5', title: 'Prizden Çıkar', description: 'Kullanmadığınız cihazları prizden çıkarın. Bekleme modu bile enerji harcar.', category: 'energy', icon: '🔌' },
    { id: '6', title: 'Doğal Işık', description: 'Gündüz mümkün olduğunca doğal ışık kullanın.', category: 'energy', icon: '☀️' },

    // Atık azaltma
    { id: '7', title: 'Bez Torba', description: 'Alışverişe bez torba ile gidin. Bir plastik torba doğada 500 yıl kalır.', category: 'waste', icon: '🛍️' },
    { id: '8', title: 'Geri Dönüşüm', description: 'Kağıt, cam, plastik ve metali ayrı toplayın.', category: 'waste', icon: '♻️' },
    { id: '9', title: 'Kompost', description: 'Mutfak atıklarınızı kompost yaparak gübre üretin.', category: 'waste', icon: '🥬' },

    // Ulaşım
    { id: '10', title: 'Toplu Taşıma', description: 'Özel araç yerine toplu taşıma kullanarak CO2 emisyonunu %50 azaltın.', category: 'transport', icon: '🚌' },
    { id: '11', title: 'Bisiklet', description: '5 km altı mesafeler için bisiklet kullanın.', category: 'transport', icon: '🚴' },
    { id: '12', title: 'Yürüyüş', description: 'Kısa mesafeleri yürüyerek hem sağlığınızı hem çevreyi koruyun.', category: 'transport', icon: '🚶' },

    // Yemek
    { id: '13', title: 'Yerel Ürünler', description: 'Yerel ve mevsiminde ürünler tercih edin. Daha az karbon ayak izi.', category: 'food', icon: '🥕' },
    { id: '14', title: 'Et Tüketimi', description: 'Haftada bir gün etsiz beslenme ile büyük fark yaratın.', category: 'food', icon: '🥗' },
    { id: '15', title: 'Yemek İsrafı', description: 'Yemek bırakmayın. Dünyada üretilen gıdanın 1/3\'ü israf ediliyor.', category: 'food', icon: '🍽️' },
];

// Habits for check-in
export const HABIT_TYPES = [
    { id: 'water_save', name: 'Su Tasarrufu', icon: '💧', points: 3 },
    { id: 'public_transport', name: 'Toplu Taşıma', icon: '🚌', points: 3 },
    { id: 'recycle', name: 'Geri Dönüşüm', icon: '♻️', points: 3 },
    { id: 'no_plastic', name: 'Plastik Kullanmadım', icon: '🚫', points: 3 },
    { id: 'local_food', name: 'Yerel Ürün', icon: '🥕', points: 2 },
    { id: 'energy_save', name: 'Enerji Tasarrufu', icon: '💡', points: 2 },
];

// Eco Service
export const ecoService = {
    // Günün ipucunu getir
    getDailyTip(): EcoTip {
        const today = new Date();
        const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
        const tipIndex = dayOfYear % ECO_TIPS_POOL.length;
        return ECO_TIPS_POOL[tipIndex];
    },

    // AI ile kişiselleştirilmiş ipucu al
    async getAITip(): Promise<string> {
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            const prompt = `Kısa ve motive edici bir çevre koruma ipucu yaz (maksimum 2 cümle). Günlük hayatta uygulanabilir olsun. Türkçe yaz. Sadece ipucunu yaz, başka bir şey yazma.`;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text().trim();
        } catch (error) {
            console.error('AI tip error:', error);
            return this.getDailyTip().description;
        }
    },

    // Bugün check-in yapılmış mı kontrol et
    async getTodayCheckIns(userId: string): Promise<string[]> {
        const today = new Date().toISOString().split('T')[0];

        const { data, error } = await supabase
            .from('habit_checkins')
            .select('habit_type')
            .eq('user_id', userId)
            .gte('checked_at', today);

        if (error) {
            console.error('Error fetching checkins:', error);
            return [];
        }

        return (data || []).map(item => item.habit_type);
    },

    // Habit check-in yap
    async checkInHabit(userId: string, habitType: string): Promise<boolean> {
        const today = new Date().toISOString().split('T')[0];

        // Bugün zaten check-in yapılmış mı?
        const { data: existing } = await supabase
            .from('habit_checkins')
            .select('id')
            .eq('user_id', userId)
            .eq('habit_type', habitType)
            .gte('checked_at', today)
            .limit(1);

        if (existing && existing.length > 0) {
            return false; // Zaten yapılmış
        }

        // Check-in kaydet
        const { error } = await supabase
            .from('habit_checkins')
            .insert({
                user_id: userId,
                habit_type: habitType,
                checked_at: new Date().toISOString(),
            });

        if (error) {
            console.error('Error saving checkin:', error);
            return false;
        }

        // Puan ekle
        const habit = HABIT_TYPES.find(h => h.id === habitType);
        if (habit) {
            try {
                await greenPointsService.addPoints(
                    userId,
                    habit.points,
                    'daily_login', // action_type olarak daily_login kullanıyoruz (check-in için ayrı tip eklenebilir)
                    `${habit.name} alışkanlığı tamamlandı! ${habit.icon}`
                );
            } catch (e) {
                console.log('Points error:', e);
            }
        }

        return true;
    },

    // Haftalık check-in istatistiği
    async getWeeklyStats(userId: string): Promise<{ total: number; byType: Record<string, number> }> {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);

        const { data, error } = await supabase
            .from('habit_checkins')
            .select('habit_type')
            .eq('user_id', userId)
            .gte('checked_at', weekAgo.toISOString());

        if (error || !data) {
            return { total: 0, byType: {} };
        }

        const byType: Record<string, number> = {};
        data.forEach(item => {
            byType[item.habit_type] = (byType[item.habit_type] || 0) + 1;
        });

        return { total: data.length, byType };
    },
};
