"use client";

import { createContext, type ReactNode, useContext } from "react";
import { Logo, type LogoBrand } from "@/components/Logo";
import { brand as buildBrand } from "@/lib/brand";

/**
 * Klientens brand. Uden provider (flaget MULTIBRAND_ENABLED slået fra, og alle
 * timetrack-hosts) er det build-brandet, så intet ændrer sig. Se
 * docs/specs/timewren-cloud.md.
 */
export interface ClientBrand extends LogoBrand {
  /** Kort navn (PWA, ikon-labels). */
  shortName: string;
  supportEmail: string;
}

const DEFAULT: ClientBrand = buildBrand;
const Ctx = createContext<ClientBrand>(DEFAULT);

export function BrandProvider({
  value,
  children,
}: {
  value: ClientBrand;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): ClientBrand {
  return useContext(Ctx);
}

/**
 * Supportadressen i app-links. TimeTrack beholder sin faste adresse (som
 * før, og ens på server og klient); andre brands får hostens adresse.
 */
export function supportEmailOf(brand: ClientBrand): string {
  return brand.id === "timetrack" ? "support@timetrack.dk" : brand.supportEmail;
}

/** Logo for klientkomponenter: følger hostens brand. */
export function BrandLogo(props: Omit<Parameters<typeof Logo>[0], "brand">) {
  return <Logo {...props} brand={useBrand()} />;
}
