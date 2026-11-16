/**
 * TimeTrack Service Worker
 * Offline-side, cache af hashede build-filer, push-notifikationer og
 * periodisk påmindelse. Private data (API, tRPC, HTML) caches aldrig.
 */

// Bump ved ændringer i cache-strategien: activate sletter alle andre
// timetrack-caches, også v2-cachene der indeholdt private tRPC- og HTML-svar.
const CACHE_VERSION = "v3";
// Hashede, immutable build-filer (/_next/static) og ikoner.
const STATIC_CACHE = `timetrack-static-${CACHE_VERSION}`;
// Offline-siden og dens egne build-filer. Rammes ikke af loftet nedenfor og
// fornyes, når appens version skifter (APP_VERSION-besked fra siden).
const SHELL_CACHE = `timetrack-shell-${CACHE_VERSION}`;
const SHELL_VERSION_KEY = "/__shell-version";
const KEEP_CACHES = [STATIC_CACHE, SHELL_CACHE];

const OFFLINE_URL = "/offline";

// Kun offentlige, ikke-personlige filer. Dashboard-sider er `private, no-store`
// og må aldrig ligge i Cache Storage (delte enheder, orgskift).
const SHELL_ASSETS = [
  OFFLINE_URL,
  "/manifest.json",
  // Offline-siden indlæser scriptet i <head>; uden det falder klienten
  // tilbage til build-tidsværdier (#1017).
  "/runtime-config.js",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// Hvert deploy giver nye chunk-navne; gamle fjernes, når loftet nås.
const MAX_STATIC_ENTRIES = 400;

// Nødside når selve offline-siden ikke er i cachen. Service workeren kan ikke
// læse cookien `locale`, så sproget følger browserens (dansk som standard).
const OFFLINE_FALLBACK_TEXT = {
  da: ["Du er offline", "Tjek din internetforbindelse og prøv igen."],
  en: ["You are offline", "Check your internet connection and try again."],
  de: [
    "Du bist offline",
    "Prüfe deine Internetverbindung und versuche es erneut.",
  ],
  es: [
    "Estás sin conexión",
    "Comprueba tu conexión a internet e inténtalo de nuevo.",
  ],
};

function offlineFallbackHtml() {
  const code = String(self.navigator?.language || "da")
    .slice(0, 2)
    .toLowerCase();
  const lang = code in OFFLINE_FALLBACK_TEXT ? code : "da";
  const [title, text] = OFFLINE_FALLBACK_TEXT[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem"><h1>${title}</h1><p>${text}</p></body></html>`;
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/")
  );
}

function isNoStore(response) {
  const cacheControl = response.headers.get("cache-control") || "";
  return /no-store|private/i.test(cacheControl);
}

/**
 * Install: precache offline-siden og de scripts/styles den henviser til.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await refreshShell();
      await self.skipWaiting();
    })(),
  );
});

async function fetchOk(url) {
  try {
    const res = await fetch(new Request(url, { cache: "no-cache" }));
    return res.status === 200 ? res : null;
  } catch {
    return null;
  }
}

/**
 * Hent offline-siden og dens build-filer på ny og erstat shell-cachen.
 * Hver fil hentes for sig, så én fejl ikke vælter resten. Kan offline-siden
 * ikke hentes, beholdes den gamle shell.
 */
async function refreshShell() {
  try {
    const fresh = new Map();
    await Promise.all(
      SHELL_ASSETS.map(async (url) => {
        const res = await fetchOk(url);
        if (res) fresh.set(url, res);
      }),
    );
    const offline = fresh.get(OFFLINE_URL);
    if (!offline) return false;

    const html = await offline.clone().text();
    const deps = [
      ...new Set(html.match(/\/_next\/static\/[^"'\s\\)]+/g) || []),
    ];
    await Promise.all(
      deps.map(async (url) => {
        const res = await fetchOk(url);
        if (res) fresh.set(url, res);
      }),
    );

    await caches.delete(SHELL_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    await Promise.allSettled(
      [...fresh].map(([url, res]) => shell.put(url, res)),
    );
    return true;
  } catch (error) {
    console.warn("[SW] Kunne ikke opdatere offline-siden:", error);
    return false;
  }
}

/** Siden melder appens version; ved et nyt build fornyes offline-siden. */
async function onAppVersion(version) {
  if (typeof version !== "string" || !version) return;
  try {
    const shell = await caches.open(SHELL_CACHE);
    const stored = await shell.match(SHELL_VERSION_KEY);
    const previous = stored ? await stored.text() : null;
    if (previous === version) return;
    if (previous !== null && !(await refreshShell())) return;
    const current = await caches.open(SHELL_CACHE);
    await current.put(SHELL_VERSION_KEY, new Response(version));
  } catch (error) {
    console.warn("[SW] Kunne ikke gemme appens version:", error);
  }
}

/**
 * Activate: slet alle timetrack-caches, der ikke hører til denne version.
 */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.startsWith("timetrack-") && !KEEP_CACHES.includes(name),
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Fetch: kun to ting håndteres her.
 *  - Navigationer går altid til nettet; uden net vises den precachede
 *    offline-side. HTML gemmes aldrig.
 *  - Hashede build-filer og ikoner serveres fra cache.
 * Alt andet (/api/*, tRPC, SSE på /api/realtime, RSC-svar, billeder) røres
 * ikke og går direkte til nettet med browserens normale cache-regler.
 */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflineFallback(request));
    return;
  }

  // Netværk først (nøglen kan skifte med env), shell-kopien kun offline.
  if (url.pathname === "/runtime-config.js") {
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await caches.open(SHELL_CACHE);
        return (await shell.match("/runtime-config.js")) || Response.error();
      }),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(event, request));
  }
});

async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch (_error) {
    const shell = await caches.open(SHELL_CACHE);
    const offlinePage = await shell.match(OFFLINE_URL);
    return (
      offlinePage ||
      new Response(offlineFallbackHtml(), {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(event, request) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;
  } catch {
    // Cache Storage utilgængelig — hent fra nettet.
  }

  const response = await fetch(request);
  // Kun hele, almindelige svar (ikke 206/Range, opaque eller no-store).
  if (
    response.status === 200 &&
    !response.headers.has("content-range") &&
    !isNoStore(response)
  ) {
    // Skrivningen må aldrig koste svaret: fuld kvote (iOS) eller en fejl i
    // put sluges, og netværkssvaret leveres altid.
    event.waitUntil(storeStatic(request, response.clone()));
  }
  return response;
}

async function storeStatic(request, response) {
  try {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response);
    await trimCache(cache);
  } catch (error) {
    console.warn("[SW] Kunne ikke cache fil:", request.url, error);
  }
}

async function trimCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_STATIC_ENTRIES;
  if (excess <= 0) return;
  // keys() er i indsættelsesrækkefølge — de ældste builds ryger først.
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

/**
 * Periodic Background Sync - for weekly reports
 * Requires permission and only works in installed PWAs
 */
self.addEventListener("periodicsync", (event) => {
  console.log("[SW] Periodic sync event:", event.tag);

  if (event.tag === "weekly-report") {
    event.waitUntil(generateWeeklyReport());
  }
});

/**
 * Generate and send weekly report
 */
async function generateWeeklyReport() {
  try {
    console.log("[SW] Generating weekly report...");

    // Note: This is a placeholder. The /api/trpc/reports.weekly endpoint
    // needs to be implemented in the reports router for full functionality.
    // For now, we'll send a simple notification to remind users.

    // Send notification to view reports page
    await self.registration.showNotification("Din ugentlige rapport", {
      body: "Tid til at gennemgå dine tidsposteringer for denne uge",
      icon: SW_BRAND.icon,
      badge: "/icons/icon-72x72.png",
      tag: "weekly-report",
      data: {
        url: "/dashboard/reports",
      },
      actions: [
        {
          action: "view",
          title: "Se rapporter",
        },
        {
          action: "dismiss",
          title: "Afvis",
        },
      ],
    });

    console.log("[SW] Weekly report notification sent");
  } catch (error) {
    console.error("[SW] Failed to generate weekly report:", error);
  }
}

/**
 * Push notification event
 */
// Brandet kommer med som ?brand= på registreringen (kun TimeWren; ingen = TimeTrack).
const SW_BRAND =
  new URL(self.location.href).searchParams.get("brand") === "timewren"
    ? { title: "TimeWren", icon: "/brand/timewren/icon-192.png" }
    : { title: "TimeTrack", icon: "/icons/icon-192x192.png" };

self.addEventListener("push", (event) => {
  console.log("[SW] Push notification received");

  let notificationData = {
    title: SW_BRAND.title,
    body: "Du har en ny notifikation",
    icon: SW_BRAND.icon,
    badge: "/icons/icon-72x72.png",
    tag: "timetrack-notification",
  };

  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        title: data.title || notificationData.title,
        body: data.body || notificationData.body,
        icon: data.icon || notificationData.icon,
        badge: data.badge || notificationData.badge,
        tag: data.tag || notificationData.tag,
        data: data.data || {},
      };
    } catch (error) {
      console.error("[SW] Failed to parse push data:", error);
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      data: notificationData.data,
      vibrate: [200, 100, 200],
      requireInteraction: false,
    }),
  );
});

/**
 * Notification click event
 */
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification clicked");
  event.notification.close();

  const relativeUrl = event.notification.data?.url || "/dashboard";
  const urlToOpen = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Check if there's already a window open
        for (const client of clients) {
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        // Open new window if none exists
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      }),
  );
});

/**
 * Message event - handle messages from clients
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data?.type === "APP_VERSION") {
    event.waitUntil(onAppVersion(event.data.version));
  }
});

console.log("[SW] Service worker script loaded");
