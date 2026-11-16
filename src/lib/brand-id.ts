/**
 * Brand-valget uden afhængigheder, så det kan bruges i middleware (edge) og
 * klientkode. Se brand.ts for resten af brandet (#968).
 *
 * NEXT_PUBLIC_BRAND=timetrack giver Mahopes danske cloud; alt andet (også
 * tom/manglende) giver TimeWren, så en selvhoster aldrig ser TimeTrack-brandet
 * ved en fejl. Værdien læses ved kørsel (runtime-env.ts, #1017), så samme
 * image kan køre som begge brands.
 */
import { brandEnv, hostBrandEnv } from "@/lib/runtime-env";

export type BrandId = "timewren" | "timetrack";

export function getBrandId(): BrandId {
  return brandEnv() === "timetrack" ? "timetrack" : "timewren";
}

/**
 * Brandet for den host, browseren står på (TimeWren på timewren.com med et
 * TimeTrack-build), fra /runtime-config.js. Server og timetrack-hosts:
 * undefined. React-kode bruger useBrand(); denne er til kode uden for
 * React-træet (global-error, syncT/sharedT i browseren).
 */
export function getHostBrandId(): BrandId | undefined {
  const v = hostBrandEnv();
  return v === "timetrack" || v === "timewren" ? v : undefined;
}
