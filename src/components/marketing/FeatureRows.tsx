import type { ReactNode } from "react";
import { mk } from "./mk";

export type FeatureRow = { title: string; text: ReactNode };

/**
 * Sektionsmønsteret til SEO-sider (issue #825 fase 2.5): overskrift til
 * venstre, konkrete rækker til højre. Erstatter de tre ens ikon-kort
 * (`md:grid-cols-3`). Overskrifter skal sige noget konkret, ikke "Overblik".
 */
export function FeatureRows({
  title,
  intro,
  items,
  children,
  tone = "papir",
}: {
  title: string;
  intro?: ReactNode;
  items: FeatureRow[];
  /** Ekstra indhold under rækkerne, fx et link. */
  children?: ReactNode;
  tone?: "papir" | "flade";
}) {
  return (
    <section
      className={`${mk.section} ${tone === "flade" ? "bg-tt-flade" : ""}`}
    >
      <div
        className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16 [&>*]:min-w-0`}
      >
        <div>
          <h2 className={mk.h2}>{title}</h2>
          {intro && <p className={`${mk.body} mt-4`}>{intro}</p>}
        </div>
        <div>
          <dl className="border-t border-tt-streg">
            {items.map((item) => (
              <div
                key={item.title}
                className="grid gap-1 border-b border-tt-streg py-5 sm:grid-cols-[220px_1fr] sm:gap-6"
              >
                <dt className="font-semibold text-tt-blaek">{item.title}</dt>
                <dd className={mk.body}>{item.text}</dd>
              </div>
            ))}
          </dl>
          {children}
        </div>
      </div>
    </section>
  );
}
