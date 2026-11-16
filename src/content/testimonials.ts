/**
 * Kundecitater til marketing-sitet.
 *
 * Det offentlige repo leveres uden citater. Tilføj egne her; et citat vises
 * kun, når `quote` er udfyldt med kundens godkendte ordlyd.
 */
export type Testimonial = {
  id: string;
  name: string;
  role: string;
  company: string;
  /** Kundens godkendte citat. null = afventer godkendelse. */
  quote: string | null;
  /** Valgfri: sti til portræt i /public (kvadratisk, min. 160 px). */
  image?: string;
  /** Billedet er et logo, ikke et portræt: vises som firkant uden gråtone. */
  imageIsLogo?: boolean;
  /** Valgfri: firmalogo i /public, vist som lille mærke ved siden af navnet. */
  logoImage?: string;
};

export const TESTIMONIALS: Testimonial[] = [];

export function approvedTestimonials(): Testimonial[] {
  return TESTIMONIALS.filter((t) => Boolean(t.quote?.trim()));
}
