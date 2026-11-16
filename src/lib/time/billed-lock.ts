import { TRPCError } from "@trpc/server";
import { st } from "@/i18n/sync-text";
import { toRateDateKey } from "@/lib/rates/scheduled";

/**
 * Fakturerede tidsposter er låst (#702). Én guard for alle skriveveje: web
 * (tRPC), REST, MCP, desktop-sync, browser-extension, timeseddel-grid og
 * klippekort-træk.
 *
 * En post er låst når den er `isBilled` ELLER hænger på en faktura
 * (`invoiceId`). Låsen hæves kun ad de eksisterende veje: fakturakladden
 * slettes, linjen fjernes fra kladden, eller fakturaen krediteres med
 * "frigiv tidsposter" — de nulstiller alle `isBilled` og `invoiceId`.
 * En manuelt markeret post (isBilled uden faktura) låses op ved at fjerne
 * markeringen.
 *
 * Det eneste felt der må ændres på en låst post, er den interne note
 * (`notes`), som ikke står på fakturaen.
 */

export type BilledLockEntry = {
  isBilled: boolean | null;
  invoiceId?: string | null;
};

export function isBilledLocked(entry: BilledLockEntry): boolean {
  return entry.isBilled === true || !!entry.invoiceId;
}

export function billedLockMessage(entry: BilledLockEntry): string {
  return st(entry.invoiceId ? "billedLock.onInvoice" : "billedLock.marked");
}

/** Kaster FORBIDDEN hvis posten er faktureret (sletning, hel-post-ændring). */
export function assertEntryNotBilled(entry: BilledLockEntry): void {
  if (isBilledLocked(entry)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: billedLockMessage(entry),
    });
  }
}

/**
 * Bulk-variant: afviser hele handlingen hvis blot én post er faktureret, så
 * brugeren ikke står med en halvt udført sletning/flytning.
 */
/** `action` er en intern handlingsnøgle (dansk verbum i kaldene), ikke en tekst brugeren ser. */
const BULK_ACTION_KEYS: Record<string, string> = {
  slettes: "delete",
  ændres: "edit",
  flyttes: "move",
};

export function assertNoEntriesBilled(
  entries: ReadonlyArray<BilledLockEntry>,
  action: string,
): void {
  const locked = entries.filter(isBilledLocked);
  if (locked.length === 0) return;
  if (entries.length === 1) assertEntryNotBilled(locked[0]);
  throw new TRPCError({
    code: "FORBIDDEN",
    message: st(`billedLock.bulk.${BULK_ACTION_KEYS[action] ?? "edit"}`, {
      count: locked.length,
    }),
  });
}

/** Felter der må ændres på en faktureret post. */
const EDITABLE_WHEN_BILLED = new Set(["notes", "updatedAt"]);

const NUMERIC_FIELDS = new Set(["hours", "billableRate", "costRate"]);
const BOOLEAN_FIELDS = new Set([
  "isBillable",
  "isBilled",
  "isPrepaid",
  "isFromTemplate",
]);
const DAY_FIELDS = new Set(["date"]);
const TIMESTAMP_FIELDS = new Set([
  "startTime",
  "endTime",
  "approvedAt",
  "rejectedAt",
  "createdAt",
]);

function normalize(field: string, value: unknown): string | null {
  if (BOOLEAN_FIELDS.has(field)) {
    // NULL i en nullable boolean-kolonne betyder kolonnens default
    if (value === undefined || value === null || value === "") {
      return field === "isBillable" ? "1" : "0";
    }
    return value === true || value === 1 || value === "1" || value === "true"
      ? "1"
      : "0";
  }
  if (value === undefined || value === null || value === "") return null;
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(value);
    // Timer og satser gemmes med to decimaler — 1.3333 fra en h:m:s-formular
    // er den samme værdi som de gemte 1.33
    return Number.isFinite(n) ? n.toFixed(2) : String(value);
  }
  if (DAY_FIELDS.has(field)) {
    if (typeof value === "string" || value instanceof Date) {
      return toRateDateKey(value) ?? String(value);
    }
    return String(value);
  }
  if (TIMESTAMP_FIELDS.has(field) || value instanceof Date) {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? String(value) : String(d.getTime());
  }
  return String(value);
}

/**
 * Felter i `patch` (kolonnenavn → ny værdi) der ændrer en låst kolonne.
 * `undefined` i patchen betyder "ikke sendt" og tæller ikke som ændring.
 */
export function lockedFieldChanges(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined || EDITABLE_WHEN_BILLED.has(field)) continue;
    if (normalize(field, existing[field]) !== normalize(field, value)) {
      changed.push(field);
    }
  }
  return changed;
}

/** Fjerner patchen en manuel faktureret-markering (uden faktura)? */
export function isManualUnbill(
  existing: BilledLockEntry,
  patch: Record<string, unknown>,
): boolean {
  return (
    !existing.invoiceId &&
    existing.isBilled === true &&
    "isBilled" in patch &&
    patch.isBilled !== undefined &&
    normalize("isBilled", patch.isBilled) === "0"
  );
}

/**
 * Guard for ændringer af én post. Tillader:
 *  - alt på en ufaktureret post,
 *  - ændringer der kun rører `notes` (eller sender uændrede værdier),
 *  - at fjerne en manuel faktureret-markering (evt. sammen med andre
 *    rettelser — det er netop den bevidste handling der låser op).
 * Alt andet kaster FORBIDDEN.
 */
export function assertBilledPatchAllowed(
  existing: BilledLockEntry & Record<string, unknown>,
  patch: Record<string, unknown>,
): void {
  if (!isBilledLocked(existing)) return;
  if (isManualUnbill(existing, patch)) return;
  if (lockedFieldChanges(existing, patch).length === 0) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: billedLockMessage(existing),
  });
}
