import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { klippekortModel } from "./huller-model";

/**
 * Klippekortet som huller (docs/BRAND.md → Klippekortet: regler). Brugte
 * timer er udfyldte huller, resten står åbne; en rest under et helt hul er
 * halvfyldt. Samme visning i klippekort-oversigten, på kunden og i
 * kundeportalen (erstatter bjælken).
 *
 * Farver kommer fra --tt-* tokens og følger lys/mørk. `color` kan overstyre
 * hullernes farve (fx kundens egen portalfarve).
 */

export type KlippekortTone = "normal" | "lav" | "tom" | "inaktiv";

interface KlippekortHullerProps {
  totalHours: number;
  remainingHours: number;
  /** "sm" til tabeller og lister, "md" til kort. */
  size?: "sm" | "md";
  tone?: KlippekortTone;
  /** Vis "7 t tilbage af 20" og evt. note under hullerne. */
  showLabel?: boolean;
  /** Overstyr hullernes farve (CSS-farve). */
  color?: string;
  className?: string;
}

// Huller er højst ca. 22 px (BRAND.md); md = 18 px, sm = 10 px.
const HOLE_PX = { sm: 10, md: 18 } as const;
const GAP_PX = { sm: 3, md: 6 } as const;
const PER_ROW = 10;

// Status-farverne er appens egne (warning-600, danger-600); alle mindst 3:1
// mod hvid og mod den mørke flade (WCAG 1.4.11).
const toneColor: Record<KlippekortTone, string> = {
  normal: "var(--tt-gran)",
  lav: "#D97706",
  tom: "#DC2626",
  inaktiv: "#6B7280",
};

export function KlippekortHuller({
  totalHours,
  remainingHours,
  size = "md",
  tone = "normal",
  showLabel = false,
  color,
  className = "",
}: KlippekortHullerProps) {
  const t = useTranslations("klippekort");
  const locale = useLocale();
  const m = klippekortModel(totalHours, remainingHours);
  const fill = color ?? toneColor[tone];
  const num = (n: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      maximumFractionDigits: 2,
    }).format(n);
  const note = m.note ? t("holes.note", { hours: m.hoursPerHole }) : null;
  const label =
    t("holes.label", {
      remaining: num(m.remainingHours),
      total: num(m.totalHours),
    }) +
    (m.overdraftHours > 0
      ? t("holes.overdrawn", { overdraft: num(m.overdraftHours) })
      : "");
  const ariaLabel = note ? `${label} (${note})` : label;
  const hole = HOLE_PX[size];
  const gap = GAP_PX[size];

  const style = { "--kk-fyld": fill } as CSSProperties;

  return (
    <div className={className} style={style}>
      {m.useBar ? (
        <div
          role="img"
          aria-label={ariaLabel}
          className={`w-full overflow-hidden rounded-full border border-tt-kant ${size === "sm" ? "h-2" : "h-3"}`}
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
          className="grid w-fit"
          style={{
            gridTemplateColumns: `repeat(${Math.min(Math.max(m.holes.length, 1), PER_ROW)}, ${hole}px)`,
            gap: `${gap}px`,
          }}
        >
          {m.holes.map((state, i) => (
            <span
              // Hullerne har ingen identitet ud over deres plads.
              // biome-ignore lint/suspicious/noArrayIndexKey: fast rækkefølge
              key={i}
              data-hul={state}
              className="relative block overflow-hidden rounded-full border-[1.5px] border-tt-kant"
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
          className={`mt-2 text-tt-graa ${size === "sm" ? "text-xs" : "text-sm"}`}
          aria-hidden="true"
        >
          {t.rich("holes.visible", {
            remaining: num(m.remainingHours),
            total: num(m.totalHours),
            b: (chunks) => (
              <span className="font-semibold text-tt-blaek tabular-nums">
                {chunks}
              </span>
            ),
          })}
          {m.overdraftHours > 0 &&
            t("holes.overdrawn", { overdraft: num(m.overdraftHours) })}
          {note && <span className="ml-2">{note}</span>}
        </p>
      )}
    </div>
  );
}
