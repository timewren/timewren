/**
 * Valg af fillager. Produktion bruger S3 (S3_ENDPOINT sat) og påvirkes ikke.
 *
 * - `STORAGE_DRIVER=local`: filer ligger på disken under `STORAGE_LOCAL_PATH`
 *   (monter et Docker-volume dér). Vinder over S3_ENDPOINT.
 * - ellers S3, hvis `S3_ENDPOINT` er sat
 * - ellers intet lager (uploads er slået fra, dataeksport bygges on-demand)
 */

export type StorageDriver = "s3" | "local" | "none";

export const DEFAULT_LOCAL_STORAGE_PATH = "./data/storage";

export function getStorageDriver(
  env: NodeJS.ProcessEnv = process.env,
): StorageDriver {
  if (env.STORAGE_DRIVER?.trim().toLowerCase() === "local") return "local";
  if (env.S3_ENDPOINT) return "s3";
  return "none";
}

export function isStorageConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getStorageDriver(env) !== "none";
}

export function localStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.STORAGE_LOCAL_PATH?.trim() || DEFAULT_LOCAL_STORAGE_PATH;
}
