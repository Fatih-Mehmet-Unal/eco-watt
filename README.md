# 🌱 Yeşil Dönüşüm - React Native Mobil Uygulama

Şirketlerin elektrik tüketim verilerini görüntüleyebileceği ve talep oluşturabileceği React Native mobil uygulaması.

## ✅ Proje Durumu: SUPABASE İLE TAM ENTEGRASYONa GEÇİŞ TAMAMLANDI

### � Yeni Özellikler:
- ✅ **Supabase Authentication**: Gerçek kullanıcı giriş/kayıt sistemi
- ✅ **PostgreSQL Database**: Supabase ile tam veritabanı entegrasyonu
- ✅ **Row Level Security**: Güvenli veri erişimi
- ✅ **Real Navigation**: React Navigation Stack Navigator
- ✅ **TypeScript**: Tam tip güvenliği
- ✅ **Environment Configuration**: .env dosyası desteği

### 📱 Ekranlar:
- **LoginScreen**: Email/şifre ile giriş
- **RegisterScreen**: Yeni kullanıcı kaydı  
- **DashboardScreen**: Elektrik talep ve fiyat tabloları
- **CreateDemandScreen**: Yeni elektrik talebi oluşturma
- **AllCompaniesScreen**: Tüm şirketler görünümü

## 🛠️ Kurulum

### 1. Dependencies'leri yükleyin
```bash
npm install
cd ios && pod install && cd ..
```

### 2. Supabase Konfigürasyonu

#### .env dosyasını güncelleyin:
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key_here
NODE_ENV=development
GEMINI_API_KEY=your_gemini_api_key_here
```

#### Supabase projesinde schema'yı oluşturun:
1. Supabase Dashboard → SQL Editor
2. `supabase-schema.sql` dosyasının içeriğini çalıştırın

### 3. Uygulamayı çalıştırın
```bash
npm run ios    # iOS
npm run android # Android
npm start      # Metro bundler
```

## 🧪 Demo/Test

### Demo Hesap:
```
Email: test@example.com
Şifre: 123456
```

### Test Şirket Kodları:
- COMP001: Yeşil Enerji A.Ş.
- COMP002: Ekoloji Teknoloji Ltd.
- COMP003: Sürdürülebilir Çözümler A.Ş.

## 📊 Database Schema

### Ana Tablolar:
- **companies**: Şirket bilgileri
- **user_profiles**: Kullanıcı profilleri (auth ile bağlantılı)
- **electricity_demands**: Elektrik talep verileri  
- **electricity_prices**: Elektrik fiyat bilgileri
- **demand_requests**: Talep istekleri

## 🚨 Troubleshooting

### iOS Build Sorunları:
```bash
./clean-and-install.sh
```

### Supabase Bağlantı:
1. `.env` dosyasını kontrol edin
2. Supabase API anahtarlarını verify edin
3. Database schema'nın oluşturulduğundan emin olun

---

**Tech Stack**: React Native 0.81.1 + Supabase + TypeScript ✅

### Çözüm (Otomatik):

```bash
# Metro server'ı durdur (Ctrl+C)
./clean-and-install.sh
```

### Çözüm (Manuel):

```bash
# 1. Metro server'ı durdur (Ctrl+C)

# 2. Temizlik
rm -rf node_modules package-lock.json
cd ios && rm -rf Pods Podfile.lock && cd ..

# 3. Yeniden yükle
npm install
cd ios && pod install && cd ..

# 4. Çalıştır
npm start
npm run ios
```

## 🛠 Kurulum

### Ön Gereksinimler

### Hızlı Başlangıç

```bash
# Temizlik ve kurulum
./clean-and-install.sh

# Metro server'ı başlat
npm start

# iOS uygulamasını çalıştır (yeni terminal)
npm run ios
```

## 📋 Uygulama Yapısı

```
src/
├── screens/
│   ├── LoginScreen.tsx      # Şirket giriş ekranı
│   └── DashboardScreen.tsx  # Ana dashboard ekranı
├── types/
│   └── navigation.ts        # TypeScript tip tanımları
└── components/              # Yeniden kullanılabilir bileşenler
```

## 🔧 Teknolojiler

- **React Native 0.81**: Mobil uygulama framework'ü
- **TypeScript**: Tip güvenliği
- **React Navigation**: Temel navigation
- **React Native Safe Area Context**: Güvenli alan yönetimi

## 📊 Veri Yapısı

### Elektrik Talep Verisi
```typescript
interface ElectricityDemand {
  hour: string;      // Saat aralığı
  demand: number;    // Talep (kWh)
  cost: number;      // Maliyet (TL)
}
```

### Elektrik Fiyat Verisi
```typescript
interface ElectricityPrice {
  hour: string;           // Saat aralığı
  unitPrice: number;      // Birim fiyat (TL/kWh)
  period: 'peak' | 'off-peak' | 'normal';  // Dönem
}
```

## 🎨 Tasarım

Uygulama yeşil dönüşüm temasını yansıtan:
- Ana renk: `#2E8B57` (SeaGreen)
- Yoğun dönem: `#FF6B6B` (Kırmızı)
- Normal dönem: `#4ECDC4` (Turkuaz)
- Düşük dönem: `#45B7D1` (Mavi)

## 🔄 Geliştirme

### Yeni Özellik Eklemek

1. `src/screens/` klasörüne yeni ekran ekleyin
2. `App.tsx` dosyasında navigation mantığını güncelleyin

### Sorun Giderme

1. **Metro server çalışmıyor**: `npm start`
2. **iOS build hatası**: `./clean-and-install.sh` çalıştırın
3. **TypeScript hataları**: `npx tsc --noEmit` ile kontrol edin

## 📱 Demo Kullanımı

1. Uygulamayı başlatın: `npm start` → `npm run ios`
2. Giriş ekranında demo bilgilerini girin:
   - **Şirket Kodu**: COMP001
   - **Şifre**: 123456
3. Dashboard'da elektrik talep ve fiyat tablolarını görüntüleyin

## 📝 Dosyalar

- `IOS_BUILD_FIX.md` - Detaylı iOS build sorunu çözümleri
- `clean-and-install.sh` - Otomatik temizlik scripti
- `.github/copilot-instructions.md` - Proje geliştirme notları

Proje hazır durumda! 🎉

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
