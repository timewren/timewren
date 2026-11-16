"use client";

import { useEffect, useState } from "react";

/**
 * true, indtil mediequeryen er bekræftet i browseren (dvs. ingen bevægelse
 * før vi ved det), og følger ændringer, hvis brugeren skifter indstillingen
 * mens siden er åben.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
