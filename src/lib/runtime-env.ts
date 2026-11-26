/**
 * Runtime-konfiguration for app-URL, marketing-URL og brand (#1017).
 *
 * NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_MARKETING_URL og NEXT_PUBLIC_BRAND var
 * tidligere build-argumenter, som Next inlinede i både server- og klientbundt.
 * Det gjorde ét image uanvendeligt til flere URL'er og brands. Nu læses de ved
 * kørsel:
 *
 *  - Server (Node og middleware): `process.env[navn]` med dynamisk nøgle, som
 *    Next ikke inliner, så værdien er den, processen blev startet med.
 *  - Klient: `window.__TT_CONFIG__`, som `/runtime-config.js` (route.ts,
 *    læst fra serverens env pr. forespørgsel) sætter synkront i <head> før
 *    appens bundt.
 *  - Fallback: den build-tids-inlinede værdi (de bare `process.env.X`
 *    nedenfor). Et image bygget med de gamle build-args opfører sig derfor
 *    uændret, og TimeTrack Cloud får samme output som før.
 *
 * Variabelnavnene er uændrede. Modulet afhænger kun af demo-mode.ts (som selv
 * er uden afhængigheder), så det kan bruges i middleware (edge) og klientkode.
 */

import { isDemoMode } from "@/lib/demo/demo-mode";

export interface RuntimeConfig {
  appUrl?: string;
  marketingUrl?: string;
  brand?: string;
  /**
   * Multibrand: brandet for den host, scriptet blev hentet fra, når det
   * afviger fra build-brandet (TimeWren på timewren.com). Mangler ellers, så
   * timetrack-hosts får præcis samme script som før.
   */
  hostBrand?: string;
  /**
   * Offentlig demo (DEMO_MODE=1, src/lib/demo/demo-mode.ts). Sættes kun i
   * demo-tilstand, så alle andre instanser får præcis samme script som før.
   */
  demo?: true;
}

declare global {
  interface Window {
    __TT_CONFIG__?: RuntimeConfig;
  }
}

// De bare referencer skal stå som `process.env.NAVN`, ellers inliner Next dem
// ikke. `build` er funktioner, så værdien læses på kaldstidspunktet. Ét objekt
// pr. nøgle, så en ny nøgle ikke kan glemmes i den ene halvdel.
const KEYS = {
  appUrl: {
    env: "NEXT_PUBLIC_APP_URL",
    build: () => process.env.NEXT_PUBLIC_APP_URL,
  },
  marketingUrl: {
    env: "NEXT_PUBLIC_MARKETING_URL",
    build: () => process.env.NEXT_PUBLIC_MARKETING_URL,
  },
  brand: {
    env: "NEXT_PUBLIC_BRAND",
    build: () => process.env.NEXT_PUBLIC_BRAND,
  },
} as const;

type Key = keyof typeof KEYS;

function read(key: Key): string | undefined {
  if (typeof window !== "undefined") {
    const fromWindow = window.__TT_CONFIG__?.[key];
    if (fromWindow !== undefined) return fromWindow || undefined;
    return KEYS[key].build() || undefined;
  }
  // Dynamisk nøgle: bevidst ikke inlinet af Next.
  const runtime = process.env[KEYS[key].env];
  if (runtime || (runtime === "" && key !== "appUrl")) {
    return runtime || undefined;
  }
  // An image started for another app URL or brand must explicitly opt in to marketing.
  if (
    key === "marketingUrl" &&
    ((KEYS.appUrl.build() || undefined) !== read("appUrl") ||
      (KEYS.brand.build() || undefined) !== read("brand"))
  ) {
    return undefined;
  }
  return KEYS[key].build() || undefined;
}

/** Appens base-URL (NEXT_PUBLIC_APP_URL) uden fallback; undefined hvis ikke sat. */
export function appUrlEnv(): string | undefined {
  return read("appUrl");
}

/** Marketing-URL (NEXT_PUBLIC_MARKETING_URL) uden fallback. */
export function marketingUrlEnv(): string | undefined {
  return read("marketingUrl");
}

/** Rå brand-værdi (NEXT_PUBLIC_BRAND); se brand-id.ts for normaliseringen. */
export function brandEnv(): string | undefined {
  return read("brand");
}

/**
 * Hostens brand i browseren (se RuntimeConfig.hostBrand); undefined på
 * serveren og når hosten har build-brandet.
 */
export function hostBrandEnv(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.__TT_CONFIG__?.hostBrand || undefined;
}

/**
 * JavaScript, som /runtime-config.js svarer med. Læser serverens env ved
 * kørsel. `<` og U+2028/2029 escapes, så en værdi aldrig kan afslutte et
 * script-element eller bryde linjen.
 */
export function renderRuntimeConfigScript(
  opts: { hostBrand?: string } = {},
): string {
  // Send an explicit blank when runtime clears a baked-in client fallback.
  const browserValue = (key: Key) =>
    read(key) ?? (KEYS[key].build() ? "" : undefined);
  const config: RuntimeConfig = {
    appUrl: browserValue("appUrl"),
    marketingUrl: browserValue("marketingUrl"),
    brand: browserValue("brand"),
    ...(opts.hostBrand ? { hostBrand: opts.hostBrand } : {}),
    ...(isDemoMode() ? { demo: true as const } : {}),
  };
  const json = JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window.__TT_CONFIG__=${json};`;
}

/**
 * Nøgler, hvor den kørende værdi afviger fra den, der blev bygget ind. Kun
 * relevant for statisk prerenderede sider (marketing), hvis HTML har
 * build-værdien, mens klienten læser runtime-værdien. Tom liste = enige.
 * En tom værdi kan slå en indbygget værdi fra.
 */
export function runtimeBuildMismatches(): string[] {
  const out: string[] = [];
  for (const key of Object.keys(KEYS) as Key[]) {
    const built = KEYS[key].build();
    if ((built || undefined) !== read(key)) out.push(KEYS[key].env);
  }
  return out;
}
