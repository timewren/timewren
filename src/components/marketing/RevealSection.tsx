"use client";

import { useScrollReveal } from "@/hooks/useScrollReveal";

/**
 * Sektion der toner ind når den scrolles i view. Egen klientkomponent, så
 * forsiden kan være en serverkomponent og kun denne lille ø hydreres.
 */
export function RevealSection({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const ref = useScrollReveal<HTMLElement>();
  return (
    <section id={id} ref={ref} className={`scroll-reveal ${className}`}>
      {children}
    </section>
  );
}
