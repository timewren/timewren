import Image from "next/image";
import { approvedTestimonials, TESTIMONIALS } from "@/content/testimonials";

/**
 * Lange citater får første sætning som overskrift og resten som brødtekst,
 * så ordlyden står uændret uden at blive en tekstmur.
 */
function QuoteText({ quote }: { quote: string }) {
  const match = quote.match(/^([\s\S]+?[.!?])\s+([\s\S]+)$/);
  const lead = match && quote.length > 160 ? match[1] : quote;
  const rest = match && quote.length > 160 ? match[2] : null;

  return (
    <blockquote>
      <p className="text-balance text-2xl font-semibold leading-snug tracking-[-0.015em] text-tt-blaek sm:text-[28px]">
        “{lead}
        {rest ? null : "”"}
      </p>
      {rest ? (
        <p className="mt-5 text-pretty text-lg leading-relaxed text-tt-blaek/80">
          {rest}”
        </p>
      ) : null}
    </blockquote>
  );
}

/**
 * Kundecitater (docs/BRAND.md §5). Renderer intet i produktion, før mindst
 * ét citat er godkendt med kundens egne ord (se src/content/testimonials.ts).
 * I udvikling vises en pladsholder, så man kan se, hvor citatet lander.
 */
export function Testimonials() {
  const approved = approvedTestimonials();
  const isDev = process.env.NODE_ENV !== "production";

  if (approved.length === 0 && !isDev) return null;

  const items = approved.length > 0 ? approved : TESTIMONIALS;

  return (
    <section
      aria-label="Kundecitater"
      className="border-t border-tt-streg py-20 sm:py-24"
    >
      <div
        className={`mx-auto grid gap-12 px-4 sm:px-6 lg:px-8 ${
          items.length === 1 ? "max-w-3xl" : "max-w-6xl lg:grid-cols-2"
        }`}
      >
        {items.map((t) =>
          t.quote ? (
            <figure key={t.id}>
              <QuoteText quote={t.quote} />
              <figcaption className="mt-6 flex items-center gap-4 text-sm">
                {t.image ? (
                  <Image
                    src={t.image}
                    alt=""
                    width={80}
                    height={80}
                    className={
                      t.imageIsLogo
                        ? "h-12 w-12 rounded-[10px] object-cover"
                        : "h-16 w-16 rounded-full object-cover ring-2 ring-tt-gran/20 sm:h-[72px] sm:w-[72px]"
                    }
                  />
                ) : null}
                <span className="flex items-center gap-3">
                  <span>
                    <span className="font-semibold text-tt-blaek">
                      {t.name}
                    </span>
                    <span className="block text-tt-graa">
                      {[t.role, t.company].filter(Boolean).join(", ")}
                    </span>
                  </span>
                  {t.logoImage ? (
                    <Image
                      src={t.logoImage}
                      alt={`${t.company} logo`}
                      width={36}
                      height={36}
                      className="h-9 w-9 shrink-0 rounded-[8px] object-cover"
                    />
                  ) : null}
                </span>
              </figcaption>
            </figure>
          ) : (
            <figure
              key={t.id}
              className="rounded-[14px] border-2 border-dashed border-tt-kant p-6 text-sm text-tt-graa"
            >
              Pladsholder, kun synlig i udvikling: citat fra {t.company}{" "}
              afventer godkendelse. Udfyld `quote` i src/content/testimonials.ts
              med kundens egne ord.
            </figure>
          ),
        )}
      </div>
    </section>
  );
}
