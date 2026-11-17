"use client";

import { useTranslations } from "next-intl";
import { isDemoMode } from "@/lib/demo/demo-mode";
import { useTourStore } from "@/stores/tourStore";

export const DEMO_REPO_URL = "https://github.com/timewren/timewren";
export const DEMO_SELF_HOST_URL = "https://timewren.com/docs/install/quick";

/**
 * Smal, fast bjælke øverst i appen på den offentlige demo (DEMO_MODE=1).
 * Kan ikke lukkes. Rundvisningen starter ikke af sig selv i demoen
 * (tour-gate.ts), så den tilbydes her. Uden demo-tilstand renderes intet.
 */
export function DemoBanner() {
  // Før hooks med demo-tekster: uden for demoen sendes de ikke med.
  return isDemoMode() ? <DemoBannerStrip /> : null;
}

function DemoBannerStrip() {
  const t = useTranslations("demo.banner");
  const { resetTour, startTour } = useTourStore();
  return (
    <div
      role="note"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-b border-tt-streg bg-tt-gran-lys px-4 py-1.5 text-center text-sm text-tt-blaek"
    >
      <span>{t("text")}</span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            // Som "Start rundvisning" i brugermenuen
            resetTour();
            setTimeout(() => startTour(), 300);
          }}
          className="font-medium text-tt-gran underline underline-offset-2 hover:text-tt-gran-moerk"
        >
          {t("tour")}
        </button>
        <a
          href={DEMO_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-tt-gran underline underline-offset-2 hover:text-tt-gran-moerk"
        >
          {t("github")}
        </a>
        <a
          href={DEMO_SELF_HOST_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-tt-gran underline underline-offset-2 hover:text-tt-gran-moerk"
        >
          {t("selfHost")}
        </a>
      </span>
    </div>
  );
}
