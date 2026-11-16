// Ejerskab og skrivbare felter for desktop-push (#750).
//
// Den generiske create/update i `/api/desktop/sync/push` kopierede appens
// payload direkte ind i tabellen. Et gyldigt device-token kunne derfor pege en
// tidspost på en anden organisations projekt/kunde/opgave, eller sætte felter
// som kun serveren ejer (fakturering, godkendelse, fakturastatus/-nummer,
// integrations-id'er). Her samles de to værn pr. entitet:
//
//  1. en whitelist over de felter desktop må skrive — alt andet strippes, og
//  2. et ejerskabstjek af hvert refereret id mod callerens org (bruger, når
//     der ingen org er) — samme scope som tRPC-routerne.

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { assertClientAccess } from "@/lib/trpc/routers/clientAccess";
import { assertTaskReferencesOwned } from "@/lib/trpc/routers/tasks";

export type DesktopPushAction = "create" | "update";

/**
 * Felter appen må sætte, pr. entitet og handling. Ejer- og id-felter
 * (`id`, `userId`, `organizationId`) er aldrig med: serveren stempler dem.
 *
 * - time_entry: fakturering (`isBilled`, `invoiceId`), godkendelse
 *   (`approval*`, `rejected*`), satser og skabelonfelter er server-ejede.
 *   `duration`/`durationUnit` er ikke kolonner, men input til udledningen af
 *   `hours`; `isPrepaid`/`prepaidPackageId` går gennem `sanitizeTimeEntryPush`
 *   og `deductHoursCore`, som selv scoper pakken. `clientEntryId` er
 *   idempotensnøglen og hører kun til create, ligesom `createdAt`.
 * - client: integrations-id'er (Billy/Dinero/e-conomic), demo-flag og
 *   rapport-tidsstempler sættes af serveren.
 * - klippekort: saldi strippes desuden af `sanitizeKlippekort*`; fornyelse og
 *   Alunta-kobling er server-ejet.
 * - invoice_draft: status, nummer, beløb (genberegnes fra linjerne), kind og
 *   betalings-/rykker-/integrationsfelter er server-ejede. Kunden kan kun
 *   vælges ved oprettelse.
 */
const TIME_ENTRY_FIELDS = [
  "projectId",
  "clientId",
  "taskId",
  "description",
  "notes",
  "hours",
  "date",
  "startTime",
  "endTime",
  "isBillable",
  "source",
  "duration",
  "durationUnit",
] as const;

const CLIENT_FIELDS = [
  "name",
  "email",
  "phone",
  "company",
  "address",
  "city",
  "postalCode",
  "country",
  "cvrNumber",
  "notes",
  "defaultHourlyRate",
  "paymentTermsDays",
  "roundingEnabled",
  "roundingMinutes",
  "roundingMethod",
  "defaultBillable",
  "color",
  "isActive",
  "isArchived",
] as const;

const PROJECT_FIELDS = [
  "name",
  "description",
  "clientId",
  "hourlyRate",
  "roundingEnabled",
  "roundingMinutes",
  "roundingMethod",
  "fixedPrice",
  "monthlyBudgetHours",
  "budgetHours",
  "status",
  "startDate",
  "endDate",
] as const;

const KLIPPEKORT_FIELDS = [
  "name",
  "clientId",
  "totalHours",
  "hourlyRate",
  "purchaseDate",
  "expiryDate",
  "isActive",
  "isArchived",
  "description",
  "clipSizeMinutes",
] as const;

const WRITABLE_FIELDS: Record<
  string,
  Record<DesktopPushAction, readonly string[]>
> = {
  time_entry: {
    // `createdAt` bevarer oprettelsestidspunktet på offline-registreringer
    create: [
      ...TIME_ENTRY_FIELDS,
      "clientEntryId",
      "prepaidPackageId",
      "createdAt",
    ],
    update: TIME_ENTRY_FIELDS,
  },
  client: { create: CLIENT_FIELDS, update: CLIENT_FIELDS },
  project: { create: PROJECT_FIELDS, update: PROJECT_FIELDS },
  klippekort: { create: KLIPPEKORT_FIELDS, update: KLIPPEKORT_FIELDS },
  invoice_draft: {
    create: ["clientId", "issueDate", "dueDate", "notes"],
    update: ["issueDate", "dueDate", "notes"],
  },
};

/** Samme værdier som `projects.update`-inputtet i tRPC. */
const PROJECT_STATUSES = new Set([
  "active",
  "completed",
  "on_hold",
  "archived",
]);

/**
 * Behold kun de felter desktop må skrive for `type`/`action`. Ukendte typer
 * giver et tomt objekt, så en ny entitetstype aldrig ved en fejl får fri
 * adgang til alle kolonner.
 */
export function pickDesktopWritableFields(
  type: string,
  action: DesktopPushAction,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = WRITABLE_FIELDS[type]?.[action] ?? [];
  const clean: Record<string, unknown> = {};
  for (const field of allowed) {
    if (data[field] !== undefined) clean[field] = data[field];
  }
  if (
    type === "project" &&
    clean.status !== undefined &&
    !PROJECT_STATUSES.has(String(clean.status))
  ) {
    delete clean.status;
  }
  return clean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hvilke reference-felter hver entitet har, og hvad de peger på. */
const REFERENCE_FIELDS: Record<string, readonly ReferenceField[]> = {
  time_entry: ["projectId", "clientId", "taskId"],
  project: ["clientId"],
  klippekort: ["clientId"],
  invoice_draft: ["clientId"],
  invoice_line: ["taskId"],
};

type ReferenceField = "projectId" | "clientId" | "taskId";

const NOT_FOUND_MESSAGE: Record<ReferenceField, string> = {
  projectId: "Projekt ikke fundet",
  clientId: "Klient ikke fundet",
  taskId: "Opgave ikke fundet",
};

function referenceId(field: ReferenceField, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  // Et lokalt rækkenummer eller en anden ikke-uuid kan aldrig være en af
  // org'ens rækker — og ville ellers give en Postgres-castfejl som svar.
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: NOT_FOUND_MESSAGE[field],
    });
  }
  return value;
}

/**
 * Kast hvis et refereret id i `data` ikke tilhører callerens org (eller
 * brugeren selv, uden org). Kun felter der faktisk er sendt tjekkes; `null`
 * fjerner en kobling og er altid tilladt.
 *
 * Projekt og kunde går gennem tRPC's `assertTaskReferencesOwned`, kunden
 * desuden gennem `assertClientAccess`; opgaven scopes som i
 * `time.create`/`time.update`.
 */
export async function assertDesktopReferencesOwned(
  type: string,
  data: Record<string, unknown>,
  userId: string,
  orgId: string | null,
): Promise<void> {
  const fields = REFERENCE_FIELDS[type] ?? [];
  const refs: Partial<Record<ReferenceField, string>> = {};
  for (const field of fields) {
    const id = referenceId(field, data[field]);
    if (id) refs[field] = id;
  }

  if (refs.projectId || refs.clientId) {
    await assertTaskReferencesOwned(
      userId,
      { projectId: refs.projectId, clientId: refs.clientId },
      orgId,
    );
  }

  // Per-medlem klientadgang (#206), som tRPC's projects/invoices.create: et
  // begrænset medlem må ikke koble noget på en kunde det ikke har adgang til.
  if (refs.clientId) {
    await assertClientAccess(db, userId, orgId, refs.clientId);
  }

  if (refs.taskId) {
    const task = await db.query.tasks.findFirst({
      where: and(
        eq(tasks.id, refs.taskId),
        orgId ? eq(tasks.organizationId, orgId) : eq(tasks.userId, userId),
      ),
      columns: { id: true },
    });
    if (!task) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: NOT_FOUND_MESSAGE.taskId,
      });
    }
  }
}
