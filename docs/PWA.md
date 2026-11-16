# Progressive Web App (PWA) Implementation

TimeTrack er nu en fuldt funktionel Progressive Web App (PWA) med offline support, native notifikationer og installationsmuligheder.

## 📋 Funktioner

### ✅ Implementeret

- **Service Worker**: Offline caching og background sync
- **Web App Manifest**: App metadata og ikoner til installation
- **Push Notifications**: Native notifikationer via Web Push API
- **Offline Sync**: Lokalt lagring med IndexedDB og automatisk synkronisering
- **Install Prompt**: Brugervejledning til app-installation
- **Offline Fallback**: Dedikeret offline-side
- **App Shortcuts**: Genveje til ofte brugte funktioner
- **Share Target**: Modtag delt indhold som tidsposteringer

### 🎯 Kun Dashboard

PWA-funktionaliteten aktiveres **kun efter login** på dashboard-siden. Marketing-siderne (landing page, om os, etc.) forbliver normale websider.

## 🚀 Installation

### For Brugere

#### Desktop (Chrome/Edge/Brave)

1. Log ind på TimeTrack
2. Klik på install-ikonet i adresselinjen (⊕)
3. Bekræft installation
4. App'en åbnes i eget vindue

#### iOS Safari

1. Log ind på TimeTrack
2. Tryk på Del-knappen (↑)
3. Vælg "Føj til hjemmeskærm"
4. Bekræft installation

#### Android Chrome

1. Log ind på TimeTrack
2. Tryk på menuen (⋮)
3. Vælg "Installer app" eller "Føj til hjemmeskærm"
4. Bekræft installation

### For Udviklere

Ingen ekstra opsætning kræves. PWA-funktionalitet er automatisk aktiv efter:
```bash
npm run dev
```

## 🔧 Teknisk Arkitektur

### Komponenter

```
src/
├── components/
│   ├── PWARegistration.tsx      # Service worker registration
│   └── PWAInstallPrompt.tsx     # Installation prompt UI
├── hooks/
│   └── usePushNotifications.ts  # Push notification hooks
├── lib/
│   └── offline-sync.ts          # IndexedDB utilities
├── app/
│   ├── api/push/                # Push notification API routes
│   ├── offline/page.tsx         # Offline fallback page
│   └── dashboard/layout.tsx     # PWA component integration
public/
├── sw.js                        # Service Worker
├── manifest.json                # (erstattet af src/lib/pwa/manifest.template.json + route)
└── icons/                       # App icons (various sizes)
```

### Service Worker Strategier

**Cache-First** (Statiske assets):
- JavaScript bundles
- CSS stylesheets
- Billeder og ikoner

**Network-First** (API calls):
- tRPC endpoints
- REST API calls
- Med cache fallback ved offline

**Network-Only** (Autentifikation):
- Login/logout
- Push subscription
- Session management

### Offline Data Flow

```
1. User opretter tidspostering offline
   ↓
2. Gemmes i IndexedDB (pending-entries)
   ↓
3. Background Sync registreres
   ↓
4. Når online: Service worker synkroniserer automatisk
   ↓
5. Success: Fjernes fra IndexedDB
   Failure: Forbliver i pending og prøves igen
```

## 🔔 Push Notifications

### Opsætning

1. **Generer VAPID nøgler**:
```bash
npx web-push generate-vapid-keys
```

2. **Tilføj til .env**:
```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY="<public-key>"
VAPID_PRIVATE_KEY="<private-key>"
VAPID_EMAIL="mailto:support@timetrack.dk" # udeladt = mailto:support@<EMAIL_DOMAIN>
```

3. **Kør migration** for pushSubscriptions tabel:
```bash
npm run db:generate
npm run db:migrate
```

### Brug i Kode

```typescript
import { usePushNotifications } from '@/hooks/usePushNotifications';

function Component() {
  const { isSupported, isSubscribed, subscribe, unsubscribe } = usePushNotifications();

  return (
    <button onClick={subscribe} disabled={!isSupported || isSubscribed}>
      {isSubscribed ? 'Notifikationer aktiveret' : 'Aktiver notifikationer'}
    </button>
  );
}
```

### Sende Notifikationer

Brug `web-push` pakken (allerede installeret):

```typescript
import webpush from "web-push";
import { db } from "@/lib/db";
import { pushSubscriptions } from "@/lib/db/schema";

// Konfigurer VAPID
webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
);

// Send notifikation
const subscriptions = await db.query.pushSubscriptions.findMany({
  where: eq(pushSubscriptions.userId, userId),
});

for (const sub of subscriptions) {
  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dhKey,
      auth: sub.authKey,
    },
  };

  await webpush.sendNotification(
    pushSubscription,
    JSON.stringify({
      title: "Ny tidspostering",
      body: "Du har en ny tidspostering der venter",
      icon: "/icons/icon-192x192.png",
      data: {
        url: "/dashboard/time",
      },
    }),
  );
}
```

## 🗄️ Offline Sync

### Brug i Komponenter

```typescript
import {
  storeTimeEntryOffline,
  triggerBackgroundSync,
} from "@/lib/offline-sync";

async function handleCreateTimeEntry(data) {
  if (!navigator.onLine) {
    // Gem offline
    await storeTimeEntryOffline(data);
    await triggerBackgroundSync();

    toast.success("Gemt offline", {
      description: "Synkroniseres når du er online igen",
    });
  } else {
    // Normal oprettelse
    await createTimeEntry(data);
  }
}
```

### Pending Entries Status

```typescript
import { getPendingEntryCount } from "@/lib/offline-sync";

const count = await getPendingEntryCount();
console.log(`${count} tidsposteringer venter på synkronisering`);
```

## 📱 App Manifest

Konfigureret i `src/lib/pwa/manifest.template.json` (serveres af manifest-routen, brandet pr. `NEXT_PUBLIC_BRAND`):

- **Navn**: TimeTrack - Tid til det der tæller
- **Start URL**: `/dashboard` (kun dashboard er PWA)
- **Display**: `standalone` (native app feel)
- **Theme Color**: `#3b82f6` (TimeTrack blue)
- **Shortcuts**: Genveje til ny tidspostering, klienter, projekter
- **Share Target**: Modtag delt tekst som beskrivelse

## 🧪 Testing

### Service Worker

1. Åbn DevTools → Application → Service Workers
2. Verificer at `/sw.js` er registreret
3. Test offline: Check "Offline" i Network tab
4. Naviger rundt i dashboard - alt skulle virke

### Cache

1. DevTools → Application → Cache Storage
2. Verificer caches:
   - `timetrack-v1` (precached assets)
   - `timetrack-runtime-v1` (dynamic cache)
   - `timetrack-offline-v1` (offline data)

### Push Notifications

1. DevTools → Application → Manifest
2. Verificer manifest er loaded korrekt
3. Klik "Aktiver notifikationer" i app'en
4. DevTools → Application → Service Workers
5. Klik "Push" for at teste notifikation

### Installation

**Desktop**:
- Chrome DevTools → Application → Manifest → "Add to homescreen"

**iOS Simulator**:
- Safari → Del → Føj til hjemmeskærm

**Android Emulator**:
- Chrome → Menu → Installer app

### Lighthouse PWA Audit

```bash
# Kør production build først
npm run build
npm start

# Åbn Chrome DevTools → Lighthouse
# Vælg "Progressive Web App" kategori
# Kør audit
# Mål: 100/100 score
```

## 📊 PWA Metrics

### Installation

- Track med `window.addEventListener('appinstalled')`
- Log til analytics eller Sentry

### Offline Usage

- Track pending entries count
- Monitor sync success/failure rates
- Alert ved for mange failed syncs

### Push Notification Engagement

- Open rate: Track clicks via notification data
- Conversion: Actions efter notification click
- Unsubscribe rate: Track via API

## 🔐 Sikkerhed

### Service Worker Scope

Service workeren er scoped til `/` men aktiveres kun på dashboard-sider via client-side check.

### CSP Headers

Next.js config inkluderer:
```
worker-src 'self'
manifest-src 'self'
```

### Push Notification Encryption

- VAPID nøgler for autentificering
- p256dh + auth keys per subscription
- End-to-end encryption af payloads

## 🚧 Kendte Begrænsninger

### iOS Safari

- ❌ Push notifications understøttes IKKE (iOS 16.4+ har begrænset support)
- ✅ Service worker og offline support virker
- ✅ Add to Home Screen virker

### Background Sync

- ❌ Ikke understøttet i Safari/iOS
- ✅ Fallback til immediate sync ved online event

### Badging API

- ❌ Kun Chrome/Edge på desktop
- Ikke implementeret endnu (fremtidig feature)

## 🎯 Phase 2 Features (✅ COMPLETED)

### ✅ Advanced Web APIs

**Idle Detection** (`src/hooks/useIdleDetection.ts`):
- Automatisk pause af timer ved inaktivitet
- Konfigurerbar threshold (1-30 minutter)
- Fallback til event-based detection for browsers uden native API
- Toast notification når bruger bliver idle

**Screen Wake Lock** (`src/hooks/useWakeLock.ts`):
- Hold skærm aktiv mens timer kører
- Automatisk re-request ved visibility change
- Graceful degradation på unsupported browsers

**Badging API** (`src/hooks/useBadge.ts`):
- Vis timer minutter på app-ikon
- Automatisk clear ved stop
- Desktop only (Chrome/Edge)

**Periodic Background Sync** (`src/hooks/usePeriodicSync.ts`):
- Ugentlige rapporter sendt automatisk
- Konfigureret i service worker
- Push notification med rapport summary

**Enhanced Web Share Target**:
- Modtag filer og billeder fra andre apps
- Support for PDF, Word, Excel, billeder
- POST med multipart/form-data

**Protocol Handlers**:
- `web+timetrack://` custom protocol
- Deep linking til app features

**File Handlers**:
- Åbn .csv og .json filer direkte i app'en
- Import tidsposteringer via fil-associering

### Integration

**TimerEnhancements Component** (`src/components/TimerEnhancements.tsx`):
- Orchestrates all timer-related PWA features
- Idle detection → auto-pause
- Wake lock → keep screen active
- Badge → show elapsed minutes

**PWA Settings Page** (`src/app/dashboard/settings/pwa/page.tsx`):
- Central control panel for all PWA features
- Configure idle threshold
- Enable/disable push notifications
- Toggle periodic sync
- System status overview

### Usage

```typescript
// Idle Detection
import { useIdleDetection } from "@/hooks/useIdleDetection";

const { isIdle, idleTime } = useIdleDetection({
  threshold: 300000, // 5 minutes
  enabled: true,
  onIdle: () => console.log("User went idle"),
  onActive: () => console.log("User is active"),
});

// Wake Lock
import { useWakeLock } from "@/hooks/useWakeLock";

const { isActive, request, release } = useWakeLock({
  autoRequest: true,
  showNotifications: false,
});

// Badge
import { useBadge } from "@/hooks/useBadge";

const { setBadge, clearBadge } = useBadge();
setBadge(42); // Show "42" on app icon

// Periodic Sync
import { usePeriodicSync } from "@/hooks/usePeriodicSync";

const { isRegistered, register } = usePeriodicSync({
  tag: "weekly-report",
  minInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
});
```

### Browser Support

| Feature           | Chrome  | Edge    | Safari   | Firefox |
| ----------------- | ------- | ------- | -------- | ------- |
| Idle Detection    | ✅ 94+  | ✅ 94+  | ❌       | ❌      |
| Wake Lock         | ✅ 84+  | ✅ 84+  | ⚠️ 16.4+ | ❌      |
| Badging           | ✅ 81+  | ✅ 81+  | ❌       | ❌      |
| Periodic Sync     | ✅ 80+  | ✅ 80+  | ❌       | ❌      |
| Web Share Target  | ✅ 71+  | ✅ 79+  | ⚠️ 15+   | ❌      |
| Protocol Handlers | ✅ 96+  | ✅ 96+  | ❌       | ❌      |
| File Handlers     | ✅ 102+ | ✅ 102+ | ❌       | ❌      |

✅ Full support | ⚠️ Partial support | ❌ Not supported

## 🎯 Phase 3 Features (Future)

### Planned

- [ ] Widgets (Chrome på Android) - Home screen widgets
- [ ] File System Access API (eksporter filer lokalt)
- [ ] Contact Picker API (hurtig klient-oprettelse)
- [ ] Payment Request API (modtag betalinger)
- [ ] Web Bluetooth - Sync med wearables
- [ ] Geolocation Tracking - Location-based time tracking

## 🐛 Fejlfinding

### Service Worker registreres ikke

**Symptom**: Console viser "Service workers not supported"

**Løsning**:
- Verificer HTTPS (påkrævet for service workers)
- Check browser support (ikke IE11)
- Verificer at `/sw.js` er tilgængelig: `curl https://timetrack.dk/sw.js`

### Push notifications virker ikke

**Symptom**: Subscribe fejler eller ingen notifications vises

**Løsning**:
1. Check browser support: `'Notification' in window`
2. Verificer VAPID keys er sat i .env
3. Check browser permission: `Notification.permission`
4. Test subscription endpoint: DevTools → Application → Push Messaging

### Offline sync fejler

**Symptom**: Tidsposteringer forbliver i pending efter online

**Løsning**:
1. Check IndexedDB: DevTools → Application → IndexedDB → timetrack-offline
2. Verificer API endpoint: `/api/trpc/timeEntry.create`
3. Check network tab for fejlmeddelelser
4. Manuel sync: `syncPendingEntries()` i console

### Caching problemer

**Symptom**: Gamle versioner af sider vises

**Løsning**:
1. Increment `CACHE_VERSION` i `/public/sw.js`
2. Hard refresh: Ctrl+Shift+R / Cmd+Shift+R
3. Slet caches: DevTools → Application → Clear storage
4. Unregister service worker og reload

## 📚 Ressourcer

- [MDN: Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [web.dev: PWA](https://web.dev/progressive-web-apps/)
- [Service Worker Cookbook](https://serviceworke.rs/)
- [Push API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Web App Manifest Spec](https://w3c.github.io/manifest/)

## 🤝 Support

Ved problemer eller spørgsmål:
- GitHub Issues: [timetrack/issues](https://github.com/timetrack/issues)
- Email: support@timetrack.dk
- Discord: #tech-support

---

**Sidste opdatering**: Januar 2026
**Version**: 1.0.0
**Kompatibilitet**: Chrome 80+, Safari 16.4+, Edge 80+, Firefox 90+
