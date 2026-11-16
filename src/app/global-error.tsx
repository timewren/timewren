"use client";

import { useEffect, useState } from "react";
import { brand as buildBrand, getBrand } from "@/lib/brand";
import { getHostBrandId } from "@/lib/brand-id";
import { reloadOnChunkError } from "@/lib/pwa/chunk-reload";

/**
 * Sidste udvej, når selve rod-layoutet fejler. Rod-layoutets CSS og font
 * kan mangle her, så farverne står som faste værdier fra tokens
 * (docs/brand/tokens.json) med en mørk variant via prefers-color-scheme.
 */
const css = `
.tt-ge{--p:#ffffff;--b:#1a1d1c;--g:#5f6663;--gran:#1e5b47;--paa:#ffffff;
  margin:0;min-height:100vh;display:flex;align-items:center;padding:64px 16px;
  box-sizing:border-box;background:var(--p);color:var(--b);
  font-family:Schibsted Grotesk,Arial,"Hiragino Sans","Yu Gothic UI","PingFang SC","Microsoft YaHei","Malgun Gothic","Noto Sans CJK JP",sans-serif}
@media (prefers-color-scheme:dark){.tt-ge{--p:#0a0a0a;--b:#ecefed;--g:#a3aba7;--gran:#5fb38f;--paa:#0a0a0a}}
.tt-ge main{max-width:36rem;width:100%;margin:0 auto}
.tt-ge .k{font-size:14px;font-weight:500;color:var(--g);margin:0}
.tt-ge h1{font-size:36px;line-height:1.1;letter-spacing:-0.035em;margin:8px 0 0}
.tt-ge p.t{font-size:18px;line-height:1.6;color:var(--g);margin:24px 0 0;max-width:60ch}
.tt-ge button{margin-top:40px;min-height:44px;padding:0 20px;border:0;border-radius:8px;
  background:var(--gran);color:var(--paa);font:inherit;font-weight:500;cursor:pointer}
.tt-ge button:focus-visible{outline:2px solid var(--gran);outline-offset:2px}
`;

// Rod-layoutet (og dermed udbyderen af oversættelser) er nede, så siden har sin
// egen lille ordbog. Sproget læses fra cookien `locale` efter mount; før da, og
// uden cookie, står der dansk.
const TEXT = {
  da: {
    title: "{brand} kunne ikke starte",
    text: "Der skete en fejl, før siden kunne vises. Timer, der allerede er gemt, er ikke berørt. Genindlæs siden. Hjælper det ikke, så prøv igen om et par minutter.",
    reload: "Genindlæs siden",
  },
  en: {
    title: "{brand} could not start",
    text: "Something went wrong before the page could be shown. Hours that are already saved are not affected. Reload the page. If that does not help, try again in a few minutes.",
    reload: "Reload the page",
  },
  de: {
    title: "{brand} konnte nicht starten",
    text: "Es ist ein Fehler aufgetreten, bevor die Seite angezeigt werden konnte. Bereits gespeicherte Stunden sind nicht betroffen. Lade die Seite neu. Hilft das nicht, versuche es in ein paar Minuten erneut.",
    reload: "Seite neu laden",
  },
  es: {
    title: "{brand} no pudo iniciarse",
    text: "Se produjo un error antes de poder mostrar la página. Las horas que ya estaban guardadas no se ven afectadas. Recarga la página. Si no ayuda, inténtalo de nuevo en unos minutos.",
    reload: "Recargar la página",
  },
} as const;

type GlobalErrorLocale = keyof typeof TEXT;

function localeFromCookie(): GlobalErrorLocale {
  const match = document.cookie.match(/(?:^|;\s*)locale=([a-z]{2})/);
  const code = match?.[1];
  return code && code in TEXT ? (code as GlobalErrorLocale) : "da";
}

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const [locale, setLocale] = useState<GlobalErrorLocale>("da");
  // Rod-layoutets BrandProvider er væk: hostens brand (TimeWren på
  // timewren.com) læses fra /runtime-config.js efter mount, som sproget.
  // Har layoutet aldrig rendret, indlæser siden selv scriptet.
  const [brandName, setBrandName] = useState(buildBrand.name);
  const text = TEXT[locale];

  useEffect(() => {
    setLocale(localeFromCookie());
    const showHostBrand = () => {
      const hostBrand = getHostBrandId();
      if (hostBrand) setBrandName(getBrand(hostBrand).name);
    };
    if (window.__TT_CONFIG__) {
      showHostBrand();
      return;
    }
    // Fejlede rod-layoutet ved første indlæsning, kørte /runtime-config.js
    // aldrig: hent det selv (samme origin, tilladt af CSP'ens 'self').
    const script = document.createElement("script");
    script.src = "/runtime-config.js";
    script.onload = showHostBrand;
    document.head.appendChild(script);
    return () => {
      script.onload = null;
    };
  }, []);

  useEffect(() => {
    // Et nyt deploy har fjernet det gamle builds chunks: genindlæs én gang.
    if (reloadOnChunkError(error)) return;
    // Dynamisk import: global-error ligger i root-bundtet, så en statisk
    // import trak Sentry-SDK'et ind på hver eneste side (også marketing).
    void import("@sentry/nextjs").then((Sentry) => {
      Sentry.captureException(error);
    });
  }, [error]);

  return (
    <html lang={locale}>
      <body className="tt-ge">
        <style>{css}</style>
        <main>
          <p className="k">{brandName}</p>
          <h1>{text.title.replace("{brand}", brandName)}</h1>
          <p className="t">{text.text}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {text.reload}
          </button>
        </main>
      </body>
    </html>
  );
}
