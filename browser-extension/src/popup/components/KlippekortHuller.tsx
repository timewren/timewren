import type { CSSProperties } from "react";
import { renderRich, useT } from "../../i18n";
import { formatTimer, klippekortModel } from "../../lib/klippekort-huller";

/**
 * Klippekortet som huller (docs/BRAND.md → Klippekortet: regler), samme
 * visning som web-appens src/components/klippekort/KlippekortHuller.tsx.
 * Brugte timer er udfyldte huller, resten står åbne; en rest under et helt
 * hul er halvfyldt. Over 20 t er 1 hul = 5 t (med note), og meget store
 * kort falder tilbage til en bjælke.
 *
 * Farver kommer fra tokens i styles/theme.css og følger lys/mørk.
 */

export type KlippekortTone = "normal" | "lav" | "tom";

interface KlippekortHullerProps {
  totalHours: number;
  remainingHours: number;
  /** "sm" til lister, "md" til popup'ens hovedvisning. */
  size?: "sm" | "md";
  tone?: KlippekortTone;
  /** Tekst efter saldoen, fx "på klippekortet". */
  suffix?: string;
  showLabel?: boolean;
  className?: string;
}

// Huller er højst ca. 22 px (BRAND.md); md = 12 px, så 20 huller står på én linje i popup'en.
const HOLE_PX = { sm: 9, md: 12 } as const;
const GAP_PX = { sm: 3, md: 4 } as const;
const PER_ROW = { sm: 20, md: 20 } as const;

// Statusfarverne holder mindst 3:1 mod fladen i lys og mørk (WCAG 1.4.11).
const toneColor: Record<KlippekortTone, string> = {
  normal: "var(--color-primary-600)",
  lav: "var(--color-amber-600)",
  tom: "var(--color-red-600)",
};

export function KlippekortHuller({
  totalHours,
  remainingHours,
  size = "md",
  tone = "normal",
  suffix,
  showLabel = true,
  className = "",
}: KlippekortHullerProps) {
  const { t } = useT();
  const m = klippekortModel(totalHours, remainingHours);
  const ariaLabel = [m.label, suffix, m.note && `(${m.note})`]
    .filter(Boolean)
    .join(" ");
  const hole = HOLE_PX[size];
  const gap = GAP_PX[size];
  const style = { "--kk-fyld": toneColor[tone] } as CSSProperties;

  return (
    <div className={className} style={style}>
      {m.useBar ? (
        <div
          role="img"
          aria-label={ariaLabel}
          className="w-full h-2 overflow-hidden rounded-full border border-[var(--color-border-strong)]"
        >
          <div
            className="h-full bg-[var(--kk-fyld)]"
            style={{ width: `${Math.min(100, m.usedFraction * 100)}%` }}
          />
        </div>
      ) : (
        <div
          role="img"
          aria-label={ariaLabel}
          className="flex flex-wrap"
          style={{
            // Højst PER_ROW huller pr. række; bryder før, hvis fladen er smallere
            maxWidth: `min(100%, ${PER_ROW[size] * hole + (PER_ROW[size] - 1) * gap}px)`,
            gap: `${gap}px`,
          }}
        >
          {m.holes.map((state, i) => (
            <span
              // Hullerne har ingen identitet ud over deres plads.
              // biome-ignore lint/suspicious/noArrayIndexKey: fast rækkefølge
              key={i}
              data-hul={state}
              className="relative block flex-shrink-0 overflow-hidden rounded-full border-[1.5px] border-[var(--color-border-strong)]"
              style={{
                width: hole,
                height: hole,
                borderColor: state === "tom" ? undefined : "var(--kk-fyld)",
              }}
            >
              {state !== "tom" && (
                <span
                  className="absolute inset-y-0 left-0 bg-[var(--kk-fyld)]"
                  style={{ width: state === "halv" ? "50%" : "100%" }}
                />
              )}
            </span>
          ))}
        </div>
      )}
      {showLabel && (
        <p
          className={`mt-1.5 text-[var(--color-text-secondary)] ${size === "sm" ? "text-xs" : "text-[13px]"}`}
          aria-hidden="true"
        >
          {renderRich(
            t("prepaid.labelRich", {
              remaining: formatTimer(m.remainingHours),
              total: formatTimer(m.totalHours),
            }),
            "font-semibold text-[var(--color-text-primary)]",
          )}
          {suffix ? ` ${suffix}` : ""}
          {m.overdraftHours > 0 &&
            `, ${t("prepaid.overdrawn", { hours: formatTimer(m.overdraftHours) })}`}
          {m.note && <span className="ml-2">{m.note}</span>}
        </p>
      )}
    </div>
  );
}
