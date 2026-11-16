import { useEffect, useState } from "react";

/**
 * Bredden hvor sidebarens etiketter ikke længere kan være synlige.
 *
 * Der er **én** definition, og layoutet læser den — ikke en klasse i hver
 * komponent. Sidebaren er 220 px udvidet, så hover alene tager 164 px fra
 * dagens kolonner; det er netop dem der bliver skubbet ud af skærmen i et
 * vindue på 900 px. Derfor låser et smalt vindue sidebaren i ikon-brede og
 * flytter etiketten til en tooltip i stedet for at lade hover tage pladsen.
 *
 * Tallets herfra: 1100 − 220 (sidebar) − 48 (main's `p-6`) = 832 px indhold,
 * som er bredden af `max-w-3xl` i tidslinjen. Under den kan den bredeste
 * side ikke vise sig fuldt ud, og da er etiketten den billigste at give
 * af. `tauri.conf.json`'s `minWidth: 800` er et **gulv**, ikke en tilpasning,
 * så 800 er ikke et bredde man kan regne med.
 */
export const NARROW_MAX_WIDTH = 1100;

function erSmaltVindue(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < NARROW_MAX_WIDTH;
}

/**
 * Om appen skal ligge i sit smalle layout.
 *
 * Hooken gemmer **sandt/falsk** og ikke bredden i pixel, fordi en resize
 * der sker 200 gange under en trækning på kanten så ellers ville male hele
 * ruten 200 gange. Kun et skifte over eller under grænsen giver en render.
 *
 * Efter en resize-hændelse i Tauri følger `resize` på window, fordi
 * webview'en følger vinduet — der er ingen grund til at lytte til Tauri's
 * egen `onResized`.
 */
export function useNarrowLayout(): boolean {
  const [smalt, setSmalt] = useState(erSmaltVindue);

  useEffect(() => {
    const opdater = () => setSmalt(erSmaltVindue());
    // Vinduet kan være blevet truffet i en anden bredde mellem render og
    // effekt (f.eks. mens appen lå minimeret), så læs den igen her.
    opdater();
    window.addEventListener("resize", opdater);
    return () => window.removeEventListener("resize", opdater);
  }, []);

  return smalt;
}
