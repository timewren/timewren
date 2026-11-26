/**
 * The mobile apps in App Store and Google Play, per brand. This is the only
 * place the store IDs live: the download pages, the landing pages and the
 * Smart App Banner all read from here.
 *
 * Android is not public yet (closed/internal test, moving to another Play
 * account). Set `playLive: true` for a brand when its Play listing is public;
 * until then the pages show "coming soon" without a link.
 *
 * App Store URLs have no country segment (/us/), so Apple sends visitors to
 * their own store.
 */
export type StoreBrand = "timetrack" | "timewren";

interface StoreApp {
  /** Numeric App Store ID (apps.apple.com/app/id<id>). */
  appStoreId: string;
  /** Android package name (play.google.com/store/apps/details?id=<pkg>). */
  playPackage: string;
  /** True once the Play listing is public. */
  playLive: boolean;
}

export const STORE_APPS: Record<StoreBrand, StoreApp> = {
  timetrack: {
    appStoreId: "6812371822",
    playPackage: "dk.timetrack.app",
    playLive: false,
  },
  timewren: {
    appStoreId: "6832757501",
    playPackage: "com.timewren.app",
    playLive: false,
  },
};

export function appStoreUrl(brand: StoreBrand): string {
  return `https://apps.apple.com/app/id${STORE_APPS[brand].appStoreId}`;
}

/** The Play listing, or undefined while the brand's Android app is not public. */
export function playStoreUrl(
  brand: StoreBrand,
  apps: Record<StoreBrand, StoreApp> = STORE_APPS,
): string | undefined {
  const app = apps[brand];
  return app.playLive
    ? `https://play.google.com/store/apps/details?id=${app.playPackage}`
    : undefined;
}

/**
 * Safari's Smart App Banner for Next metadata (`itunes`), which renders
 * `<meta name="apple-itunes-app" content="app-id=…">`.
 */
export function smartAppBanner(brand: StoreBrand) {
  return { appId: STORE_APPS[brand].appStoreId };
}

/** Apple's official "Download on the App Store" badge, stored in public/. */
export function appStoreBadge(
  locale: string,
  tone: "black" | "white" = "black",
): string {
  const l = ["da", "de", "es"].includes(locale) ? locale : "en";
  return `/badges/app-store/${l}-${tone}.svg`;
}
