import type { appRouter } from "@/lib/trpc/routers/index";
import { parsePrepaidMode, resolveAutoPrepaidForUpdate } from "./prepaid-auto";
import { dateMoveRestampCheck, mergeTimeEntryPatch } from "./time-entry-input";

type Caller = ReturnType<typeof appRouter.createCaller>;

export type PatchTimeEntryResult =
  | { ok: true; entry: Awaited<ReturnType<Caller["time"]["getById"]>> }
  | { ok: false; field: string; message: string };

/**
 * Delvis opdatering af en tidspost — delt af REST-PATCH og MCP's
 * `update_time_entry`.
 *
 * Den underliggende mutation er bygget til redigeringsformularen og får
 * altid hele posten. Sendes kun de ændrede felter, læses de manglende som
 * "ryd feltet" — posten mistede sin klient, og satsen blev genberegnet fra
 * default-raten. Patchen flettes derfor ind i den gemte post, så kun det
 * sendte ændres; eksplicit `null` rydder de felter der kan ryddes.
 */
export async function patchTimeEntry(
  caller: Caller,
  id: string,
  patch: Record<string, unknown>,
): Promise<PatchTimeEntryResult> {
  const prepaidMode = parsePrepaidMode(patch);
  if (!prepaidMode.ok) return prepaidMode;

  const existing = await caller.time.getById({ id });
  const merged = mergeTimeEntryPatch(existing, patch);
  if (!merged.ok) return merged;

  // `prepaid: "auto"` (#422): udløber-først-reglen vælger kortet til postens
  // (evt. nye) kunde — samme regel som web og extension.
  if (prepaidMode.auto) {
    const packageId = await resolveAutoPrepaidForUpdate(caller, existing, {
      clientId: merged.value.clientId,
      projectId: merged.value.projectId,
    });
    if (packageId !== undefined) merged.value.prepaidPackageId = packageId;
  }

  // Flyttes posten til en anden dato, skal satsen følge datoen (planlagte
  // satsændringer) — men kun hvis den gemte sats var hierarkiets sats for
  // den gamle dato. Et manuelt override bevares.
  const restamp = dateMoveRestampCheck(existing, patch, merged.value);
  if (restamp) {
    const previous = await caller.time.previewRate({
      projectId: merged.value.projectId ?? null,
      clientId: merged.value.clientId ?? null,
      hours: merged.value.hours > 0 ? merged.value.hours : 1,
      date: restamp.previousDate,
    });
    if (Number(merged.value.billableRate) === previous.hourlyRate) {
      merged.value.billableRate = undefined;
    }
  }

  await caller.time.update({
    id,
    data: merged.value as Parameters<Caller["time"]["update"]>[0]["data"],
  });

  // Læs posten tilbage, så svaret har samme form som GET — med klient og
  // projekt foldet ud. Mutationen returnerer kun de rå kolonner, hvilket
  // fik en korrekt opdateret post til at se ud som om klienten var væk.
  const entry = await caller.time.getById({ id });
  return { ok: true, entry };
}
