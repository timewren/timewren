/**
 * Fælles klasser til marketing-sitet (docs/BRAND.md → Typografi, Layout,
 * Kanter og fokus). Marketing-siderne er altid lyse: roden får `tt-lys`, så
 * --tt-* tokens holder de lyse værdier, også når appen står i mørk.
 *
 * Skala: 13/14/16/18/20/24/32/44/56/64/76 px. Overskrifter 700 med tæt
 * tracking og sætnings-versaler. Knapper og inputs 8 px radius, kort 14 px,
 * fotos 4 px. Trykflader mindst 44 px.
 */
export const mk = {
  page: "tt-lys min-h-screen bg-tt-papir text-tt-blaek",
  wrap: "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8",
  section: "border-t border-tt-streg py-20 sm:py-24",
  h1: "text-balance text-[44px] font-bold leading-[1.04] tracking-[-0.035em] sm:text-[64px] lg:text-[76px] lg:leading-[1.02]",
  h1Small:
    "text-balance text-[40px] font-bold leading-[1.05] tracking-[-0.035em] sm:text-[56px] lg:text-[64px] lg:leading-[1.02]",
  h2: "text-balance text-[32px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[44px] sm:leading-[1.06]",
  h3: "text-xl font-bold leading-snug tracking-[-0.015em]",
  lead: "text-lg leading-relaxed text-tt-graa sm:text-xl",
  body: "text-[17px] leading-relaxed text-tt-graa",
  fine: "text-sm leading-relaxed text-tt-graa",
  link: "font-medium text-tt-gran underline decoration-tt-gran/40 underline-offset-2 hover:decoration-tt-gran",
  btnPrimary:
    "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg bg-tt-gran px-5 text-base font-semibold text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk",
  btnSecondary:
    "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg border border-tt-kant bg-tt-papir px-5 text-base font-semibold text-tt-blaek transition-colors hover:bg-tt-flade",
  /** Kort/vindue: 14 px radius. Skyggen er forbeholdt klippekortet. */
  card: "rounded-[14px] border border-tt-streg bg-tt-papir",
  shot: "overflow-hidden rounded-[14px] border border-tt-streg bg-tt-flade",
} as const;
