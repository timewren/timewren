import { tr } from "@/i18n/server-text";
/**
 * Batch-godkendelse (#464): kør en handling pr. id og saml resultatet.
 * Hvert id valideres for sig (org, status, scope) i handlingen — én fejl
 * stopper ikke resten. Dubletter i input køres kun én gang.
 */
export interface BatchResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

export async function runBatch<T>(
  ids: string[],
  fn: (id: string) => Promise<T>,
): Promise<BatchResult> {
  const succeeded: string[] = [];
  const failed: BatchResult["failed"] = [];
  for (const id of Array.from(new Set(ids))) {
    try {
      await fn(id);
      succeeded.push(id);
    } catch (e) {
      failed.push({
        id,
        message:
          e instanceof Error
            ? e.message
            : await tr("serverErrors", "common.unknownError"),
      });
    }
  }
  return { succeeded, failed };
}
