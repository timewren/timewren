import { pickAutoDeductPackage } from "@/lib/prepaid/auto-select";
import { isBilledLocked } from "@/lib/time/billed-lock";
import type { appRouter } from "@/lib/trpc/routers/index";

type Caller = ReturnType<typeof appRouter.createCaller>;

/**
 * `prepaid: "auto"` i det offentlige API og MCP (#422, #209).
 *
 * Træk fra kundens klippekort efter SAMME udløber-først-regel som web og
 * extension (`pickAutoDeductPackage`): kun aktive kort med auto-træk og
 * saldo, det der udløber først. Har kunden intet sådant kort, oprettes
 * posten uden træk. Serveren trækker stadig kun på et konkret kort-id —
 * "auto" oversættes til et id her, før mutationen kaldes.
 */
export type PrepaidModeResult =
  | { ok: true; auto: boolean }
  | { ok: false; field: string; message: string };

/** Valider `prepaid`-feltet. Fraværende = intet auto-træk. */
export function parsePrepaidMode(
  body: Record<string, unknown>,
): PrepaidModeResult {
  if (!Object.hasOwn(body, "prepaid") || body.prepaid === undefined) {
    return { ok: true, auto: false };
  }
  if (body.prepaid !== "auto") {
    return { ok: false, field: "prepaid", message: 'prepaid must be "auto"' };
  }
  if (body.prepaidPackageId !== undefined) {
    return {
      ok: false,
      field: "prepaid",
      message: 'Send either prepaid: "auto" or prepaidPackageId, not both',
    };
  }
  return { ok: true, auto: true };
}

/**
 * Postens kunde: den direkte kunde, ellers projektets. Projektet slås op via
 * `projects.list` (samme opslag som tidsregistreringens projektvælger), ikke
 * `projects.getById`: den kræver læseadgang til projekter (#1116), og en rolle
 * med "none" på projekter skal stadig kunne registrere tid.
 */
async function effectiveClientId(
  caller: Caller,
  clientId: string | null | undefined,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (clientId) return clientId;
  if (!projectId) return null;
  const projects = await caller.projects.list();
  return projects.find((p) => p.id === projectId)?.clientId ?? null;
}

/**
 * Kortet "auto" skal trække fra for en ny post — null hvis kunden ingen
 * aktive auto-træk-kort med saldo har (eller posten er intern tid).
 */
export async function resolveAutoPrepaidPackageId(
  caller: Caller,
  target: { clientId?: string | null; projectId?: string | null },
): Promise<string | null> {
  const clientId = await effectiveClientId(
    caller,
    target.clientId,
    target.projectId,
  );
  if (!clientId) return null;
  const packages = await caller.prepaid.getActiveForClient({ clientId });
  return pickAutoDeductPackage(packages)?.id ?? null;
}

interface ExistingForAuto {
  isBilled: boolean | null;
  invoiceId: string | null;
  isPrepaid?: boolean | null;
  prepaidPackageId?: string | null;
  prepaidPackage?: { clientId?: string | null } | null;
}

/**
 * "auto" ved en delvis opdatering. Returnerer kort-id'et der skal sendes
 * videre som `prepaidPackageId`, eller undefined = rør ikke trækket.
 *
 * - Fakturerede poster er låst (#717): "auto" er en no-op, ikke en fejl.
 * - Er posten allerede trukket på et kort hos sin (evt. nye) kunde, beholdes
 *   trækket. Ellers ville "auto" kunne flytte trækket væk fra et kort, som
 *   netop denne post har tømt.
 * - Intet auto-kort: undefined — `time.update` løsner selv et træk hos en
 *   tidligere kunde, når posten skifter kunde.
 */
export async function resolveAutoPrepaidForUpdate(
  caller: Caller,
  existing: ExistingForAuto,
  target: { clientId?: string | null; projectId?: string | null },
): Promise<string | undefined> {
  if (isBilledLocked(existing)) return undefined;
  const clientId = await effectiveClientId(
    caller,
    target.clientId,
    target.projectId,
  );
  if (!clientId) return undefined;
  if (
    existing.isPrepaid &&
    existing.prepaidPackageId &&
    existing.prepaidPackage?.clientId === clientId
  ) {
    return undefined;
  }
  const packages = await caller.prepaid.getActiveForClient({ clientId });
  return pickAutoDeductPackage(packages)?.id ?? undefined;
}
