import Image from "next/image";
import { TESTIMONIALS } from "@/content/testimonials";

const testimonial = TESTIMONIALS.find((t) => t.id === "kundecitat-hoved");

/**
 * Kort genbrugeligt uddrag af det godkendte citat (docs/BRAND.md §5),
 * til at bruge flere steder end forsiden. `excerpt` SKAL være en ordret
 * substring af det godkendte citat — komponenten kaster, hvis den afviger,
 * så et redigeret citat ikke stille kan ende med en forkert gengivelse.
 * Forsiden viser fortsat hele citatet via home/Testimonials.tsx.
 */
export function TestimonialQuote({
  excerpt,
  className = "",
  tone = "lys",
}: {
  excerpt: string;
  className?: string;
  tone?: "lys" | "paa-gran";
}) {
  // Intet citat (fx det offentlige TimeWren-repo, der leveres uden citater):
  // vis ingenting i stedet for at vælte siden.
  if (!testimonial) return null;
  if (!testimonial.quote?.includes(excerpt)) {
    throw new Error(
      `TestimonialQuote: uddraget findes ikke ordret i det godkendte citat fra ${testimonial.name}.`,
    );
  }

  if (tone === "paa-gran") {
    return (
      <figure className={`flex items-start gap-3 ${className}`}>
        {testimonial.image ? (
          <Image
            src={testimonial.image}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <blockquote>
          <p className="text-[15px] leading-relaxed text-white">“{excerpt}”</p>
          <figcaption className="mt-1.5 text-sm text-brand-200">
            {testimonial.name}, {testimonial.company}
          </figcaption>
        </blockquote>
      </figure>
    );
  }

  return (
    <figure className={`flex items-start gap-4 ${className}`}>
      {testimonial.image ? (
        <Image
          src={testimonial.image}
          alt=""
          width={48}
          height={48}
          className="h-12 w-12 shrink-0 rounded-full object-cover"
        />
      ) : null}
      <blockquote>
        <p className="text-lg leading-relaxed text-tt-blaek">“{excerpt}”</p>
        <figcaption className="mt-2 text-sm text-tt-graa">
          <span className="font-semibold text-tt-blaek">
            {testimonial.name}
          </span>
          , {testimonial.company}
        </figcaption>
      </blockquote>
    </figure>
  );
}
