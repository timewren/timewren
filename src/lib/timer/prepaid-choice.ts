import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import type * as schema from "@/lib/db/schema";
import { prepaidPackages, timerStates } from "@/lib/db/schema";
import { assertClientAccess } from "@/lib/trpc/routers/clientAccess";

/**
 * Klippekort-valg for den kørende timer (#422).
 *
 * Valget gemmes på timerrækken, så et stop fra ENHVER flade (web, extension,
 * app) trækker fra samme kort. Tre tilstande:
 *
 * - automatisk (ingen række-værdi): udløber-først-reglen
 *   (`pickAutoDeductPackage`) afgør kortet ved stop
 * - "none": brugeren har valgt "Intet klippekort"
 * - "package": brugeren har valgt et bestemt kort
 *
 * Valget er bundet til den kunde det blev truffet for. Skifter timeren kunde,
 * gælder valget ikke længere (læses som automatisk), og det ryddes når en
 * session starter eller stoppes (`CLEARED_PREPAID_CHOICE`), så et gammelt
 * "Intet klippekort" aldrig genopstår på næste timer.
 */
export type TimerPrepaidChoice =
  | { mode: "none" }
  | { mode: "package"; packageId: string };

/** Hvad en klient kan sende: et eksplicit valg eller tilbage til automatisk. */
export type TimerPrepaidChoiceInput = { mode: "auto" } | TimerPrepaidChoice;

/** Wire-format for valget — delt af timerSync og extension. */
export const timerPrepaidChoiceInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("package"), packageId: z.string().uuid() }),
]);

/** Spredes ind i de skrivninger der starter eller afslutter en session. */
export const CLEARED_PREPAID_CHOICE = {
  prepaidChoice: null,
  prepaidPackageId: null,
  prepaidChoiceClientId: null,
} as const;

/**
 * Starter eller afslutter en timer-skrivning en session? Så nulstilles
 * klippekort-valget (CLEARED_PREPAID_CHOICE), så et valg aldrig følger med
 * over i en ny timer:
 *
 * - en frisk start (brugerens "start ny timer") eller en køet start — men
 *   kun uden opsparet tid: web-appen sender også isFreshStart, når en
 *   pauset timer genoptages, og dér skal valget blive stående
 * - en fuld nulstilling: stoppet uden tid tilbage
 *
 * Heartbeats, pauser, genoptag og adoption af den kørende timer rører det
 * ikke. Afgøres alene ud fra skrivningen (ingen læsning af rækken). Felter
 * der ikke sendes (extensionens partielle skrivninger), tæller ikke som 0.
 */
export function writeResetsPrepaidChoice(write: {
  isRunning?: boolean;
  isFreshStart?: boolean;
  isAdoption?: boolean;
  isQueuedStart?: boolean;
  elapsedSeconds?: number;
  baseSeconds?: number;
}): boolean {
  if (write.isRunning === true) {
    if (write.isQueuedStart) return true;
    return (
      !!write.isFreshStart &&
      !write.isAdoption &&
      (write.baseSeconds ?? 0) === 0
    );
  }
  if (write.isRunning === false) {
    return write.elapsedSeconds === 0 && write.baseSeconds === 0;
  }
  return false;
}

export interface TimerPrepaidChoiceRow {
  prepaidChoice?: string | null;
  prepaidPackageId?: string | null;
  prepaidChoiceClientId?: string | null;
  clientId?: string | null;
  project?: { clientId?: string | null } | null;
}

/** Timerens kunde: den direkte kunde, ellers projektets. */
export function timerEffectiveClientId(
  row: Pick<TimerPrepaidChoiceRow, "clientId" | "project">,
): string | null {
  return row.clientId ?? row.project?.clientId ?? null;
}

/**
 * Det gældende eksplicitte valg for timeren — eller null (automatisk), hvis
 * der intet er, eller valget blev truffet for en anden kunde end timerens.
 * `clientId` er med, så klienterne kan se hvilken kunde valget gælder.
 */
export function readTimerPrepaidChoice(
  row: TimerPrepaidChoiceRow | null | undefined,
): (TimerPrepaidChoice & { clientId: string }) | null {
  if (!row) return null;
  const clientId = timerEffectiveClientId(row);
  if (!clientId || row.prepaidChoiceClientId !== clientId) return null;
  if (row.prepaidChoice === "none") return { mode: "none", clientId };
  if (row.prepaidChoice === "package" && row.prepaidPackageId) {
    return { mode: "package", packageId: row.prepaidPackageId, clientId };
  }
  return null;
}

/**
 * Timerens kunde i SQL: den direkte kunde, ellers projektets. Fuldt
 * kvalificeret med alias — drizzle fjerner tabel-præfikset fra kolonner i
 * RETURNING, og så ville underforespørgslens navne kun ramme rigtigt ved et
 * tilfælde.
 */
const TIMER_EFFECTIVE_CLIENT_ID = sql.raw(
  `COALESCE("timer_states"."client_id", (SELECT "p"."client_id" FROM "projects" "p" WHERE "p"."id" = "timer_states"."project_id"))`,
);

/**
 * RETURNING-felter til de atomiske stop-skrivninger (claimForStop,
 * quickStop): valget læses i SAMME skrivning som stoppet, så stop-fladen
 * får det valg der gjaldt i stop-øjeblikket. Efter et claim kan valget ikke
 * længere ændres (setTimerPrepaidChoice afviser rækker der er ved at stoppe).
 */
export const prepaidChoiceReturning = {
  prepaidChoice: timerStates.prepaidChoice,
  prepaidPackageId: timerStates.prepaidPackageId,
  prepaidChoiceClientId: timerStates.prepaidChoiceClientId,
  effectiveClientId: sql<string | null>`${TIMER_EFFECTIVE_CLIENT_ID}`,
};

/** Valget fra en række læst med `prepaidChoiceReturning`. */
export function readReturnedPrepaidChoice(row: {
  prepaidChoice: string | null;
  prepaidPackageId: string | null;
  prepaidChoiceClientId: string | null;
  effectiveClientId: string | null;
}): (TimerPrepaidChoice & { clientId: string }) | null {
  return readTimerPrepaidChoice({ ...row, clientId: row.effectiveClientId });
}

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Gem klippekort-valget på brugerens timer — ATOMISK i én UPDATE, aldrig
 * read-then-write (jf. one-running-timer-guarden i timerSync.sync).
 *
 * Skrivningen lander kun hvis rækken i samme øjeblik
 * - har en aktiv session (kører, eller er pauset med tid),
 * - ikke er midt i et stop (et claimet stop ejer beslutningen), og
 * - står på den kunde valget gælder (direkte eller via projektet).
 *
 * Valget bumper IKKE `version`: claimForStop bruger versionen som
 * optimistisk lås, og et kortvalg fra en anden flade må ikke få et
 * igangværende stop til at fejle. Stop-fladerne læser valget friskt.
 *
 * Kalderen har valideret at kortet tilhører kunden og brugerens scope.
 * Returnerer true hvis valget blev gemt.
 */
export async function storeTimerPrepaidChoice(
  db: Pick<Db, "update">,
  userId: string,
  clientId: string,
  choice: TimerPrepaidChoiceInput,
): Promise<boolean> {
  const values =
    choice.mode === "auto"
      ? CLEARED_PREPAID_CHOICE
      : {
          prepaidChoice: choice.mode,
          prepaidPackageId: choice.mode === "package" ? choice.packageId : null,
          prepaidChoiceClientId: clientId,
        };

  const [row] = await db
    .update(timerStates)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(timerStates.userId, userId),
        sql`(COALESCE(${timerStates.isRunning}, false) OR COALESCE(${timerStates.elapsedSeconds}, 0) > 0 OR COALESCE(${timerStates.baseSeconds}, 0) > 0)`,
        sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`,
        sql`${TIMER_EFFECTIVE_CLIENT_ID} = ${clientId}`,
      ),
    )
    .returning({ id: timerStates.id });

  return !!row;
}

/**
 * Fælles for `timerSync.setPrepaidChoice` (web/app) og
 * `extension.setPrepaidChoice`: valider kortet og gem valget.
 *
 * Et valgt kort skal tilhøre brugerens org/scope OG timerens kunde — ellers
 * kunne et stop tømme en fremmed kundes saldo. Aktiv/udløb tjekkes først ved
 * selve trækket (deductHoursCore), som for et kort valgt i stop-dialogen.
 */
export async function setTimerPrepaidChoice(
  db: typeof dbType,
  params: {
    userId: string;
    orgId: string | null;
    clientId: string;
    choice: TimerPrepaidChoiceInput;
  },
): Promise<{ success: true } | { success: false; reason: "not_active" }> {
  const { userId, orgId, clientId, choice } = params;

  if (choice.mode === "package") {
    const [pkg] = await db
      .select({ id: prepaidPackages.id, clientId: prepaidPackages.clientId })
      .from(prepaidPackages)
      .where(
        and(
          eq(prepaidPackages.id, choice.packageId),
          orgId
            ? eq(prepaidPackages.organizationId, orgId)
            : eq(prepaidPackages.userId, userId),
        ),
      )
      .limit(1);
    if (!pkg) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "common.prepaidNotFound"),
      });
    }
    if (pkg.clientId !== clientId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: await tr("serverErrors", "timer.prepaidOtherClient"),
      });
    }
  }
  await assertClientAccess(db, userId, orgId, clientId);

  const stored = await storeTimerPrepaidChoice(db, userId, clientId, choice);
  return stored ? { success: true } : { success: false, reason: "not_active" };
}
