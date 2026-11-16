import * as Sentry from "@sentry/nextjs";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { tr } from "@/i18n/server-text";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { assertCanAddActiveClient } from "@/lib/billing/plan-limits";
import { resolveRequestClient } from "@/lib/client-version";
import {
  checkRestClientVersion,
  clientTooOldBody,
} from "@/lib/client-version/guard";
import { recordClientTooOld } from "@/lib/client-version/record";
import { db } from "@/lib/db";
import {
  clients,
  desktopDevices,
  desktopSyncLog,
  generatedTimeEntries,
  invoiceLines,
  invoices,
  prepaidPackages,
  prepaidUsage,
  projects,
  tasks,
  timeEntries,
} from "@/lib/db/schema";
import {
  authenticateDevice,
  deviceAuthErrorResponse,
} from "@/lib/desktop-auth";
import { resolveDesktopOrgId } from "@/lib/desktop-org";
import {
  assertDesktopReferencesOwned,
  pickDesktopWritableFields,
} from "@/lib/desktop-push-guard";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/desktop-rate-limit";
import {
  coerceTimestampFields,
  deriveHoursForTimeEntryUpdate,
  normalizeTimeEntryTiming,
  normalizeTimeEntryUpdateDate,
  resolveSyncRemoteId,
  sanitizeKlippekortInsert,
  sanitizeKlippekortUpdate,
  sanitizeTimeEntryPush,
  scopeClientEntryId,
  TIME_ENTRY_LOCAL_FIELDS,
} from "@/lib/desktop-sync";
import { recordSyncTombstone } from "@/lib/desktop-sync-tombstones";
import { assertEntryEditable } from "@/lib/enterprise/edit-guard";
import { draftInvoiceNumber } from "@/lib/invoices/draft-number";
import { resolveModuleAccess } from "@/lib/permissions/role-access";
import {
  lookupProjectClientId,
  withPrepaidSavepoint,
} from "@/lib/prepaid/entry-sync";
import { resolvePrepaidReconcile } from "@/lib/prepaid/reconcile";
import {
  INVOICE_DOMAINS,
  TIME_ENTRY_DOMAINS,
} from "@/lib/query/invalidate-domains";
import { publishDataChanged } from "@/lib/realtime";
import { trackEvent } from "@/lib/telemetry/track";
import {
  assertBilledPatchAllowed,
  assertEntryNotBilled,
  isBilledLocked,
  isManualUnbill,
} from "@/lib/time/billed-lock";
import { resolveDefaultBillable } from "@/lib/time/default-billable";
import { entryDateFromInput } from "@/lib/time/entry-date-input";
import { resolveModules } from "@/lib/trpc/routers/enterprise/middleware";
import {
  markEntriesBilled,
  recalcInvoiceTotal,
  releaseEntries,
} from "@/lib/trpc/routers/invoices";
import {
  deductHoursCore,
  reversePrepaidUsage,
} from "@/lib/trpc/routers/prepaid";
import { resolvePlanTier } from "@/lib/trpc/trpc";

interface SyncEntity {
  type: string;
  action: "create" | "update" | "delete";
  data: Record<string, unknown>;
  localId?: string;
  localUpdatedAt?: string;
}

/**
 * Svaret skal matche appens Rust-strukturer, hvor `localId` er en *streng* på
 * både `AcceptedEntity` og `ConflictEntity`. Serdes afkodning fejler på den
 * mindste manglende felt, og det fejler for hele `PushResponse` — også for de
 * poster serveren rent faktisk har committet. Appen så dem aldrig, pusher igen,
 * og uden idempotensnøgle bliver hver gentagelse en ny række dubletter.
 */
interface AcceptedResult {
  localId: string;
  remoteId: string;
  type: string;
  action: string;
}

interface ConflictResult {
  localId: string;
  remoteId: string;
  type: string;
  reason: string;
  serverData: Record<string, unknown>;
}

/**
 * Den `localId` der svaret rummer: appens egen, ellers dens `remoteId`/`id` så
 * den af en eller anden grund stadig kan finde rækken. Positionen i batchen er
 * sidste udvalg, så nøglen aldrig bliver tom.
 */
function responseLocalId(
  entity: { localId?: string; data?: Record<string, unknown> },
  index: number,
): string {
  const candidates = [entity.localId, entity.data?.remoteId, entity.data?.id];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return `index-${index}`;
}

/**
 * En fejl for én post. `index` er positionen i det indsendte array, så appen
 * kan pege på den post der fejlede, selv når den ikke sendte et `localId` —
 * ellers kan den hverken vise fejlen eller prøve igen.
 */
/** Tabeller med `is_archived` — de eneste der kan arkiveres frem for slettes. */
const ARCHIVABLE_TYPES = new Set(["client", "klippekort"]);

interface EntityError {
  index: number;
  localId?: string;
  remoteId?: string;
  type: string;
  action?: string;
  error: string;
}

// Map entity type to table and key fields
function getEntityTable(type: string) {
  switch (type) {
    case "client":
      return {
        table: clients,
        idCol: clients.id,
        userCol: clients.userId,
        updatedCol: clients.updatedAt,
      };
    case "project":
      return {
        table: projects,
        idCol: projects.id,
        userCol: projects.userId,
        updatedCol: projects.updatedAt,
      };
    case "time_entry":
      return {
        table: timeEntries,
        idCol: timeEntries.id,
        userCol: timeEntries.userId,
        updatedCol: timeEntries.updatedAt,
      };
    case "klippekort":
      return {
        table: prepaidPackages,
        idCol: prepaidPackages.id,
        userCol: prepaidPackages.userId,
        updatedCol: prepaidPackages.updatedAt,
      };
    case "invoice_draft":
      return {
        table: invoices,
        idCol: invoices.id,
        userCol: invoices.userId,
        updatedCol: invoices.updatedAt,
      };
    case "invoice_line":
      return {
        table: invoiceLines,
        idCol: invoiceLines.id,
        userCol: null,
        updatedCol: null,
      };
    default:
      return null;
  }
}

/**
 * `invoice_lines` har ingen egen `user_id` — ejerskabet ligger på
 * forældrefakturaen. Uden denne opløsning bygger update/delete kun
 * `eq(id, remoteId)`, så et gyldigt device-token kunne røre (og slette) linjer i
 * en vilkårlig organisation; uuid'erne kommer fra sitets egen `pull`/`full`.
 *
 * Samme tre guards som tRPC (invoices.ts:1667-1691): ejerskab via
 * forældrefakturaen, kun kladde-fakturaer, og skrivningen skal ske atomisk med
 * total-genberegning. En linje der ikke findes *eller* ikke tilhører
 * brugerens organisation giver samme fejl, så svaret ikke afslører om posten
 * findes i det hele taget.
 */
async function authorizeInvoiceLine(
  lineId: string,
  userId: string,
  orgId: string | null,
): Promise<{ invoiceId: string; timeEntryId: string | null }> {
  const line = await db.query.invoiceLines.findFirst({
    where: eq(invoiceLines.id, lineId),
  });
  if (!line) {
    throw new Error(`Entity not found: invoice_line/${lineId}`);
  }

  const invoice = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.id, line.invoiceId),
      orgId ? eq(invoices.organizationId, orgId) : eq(invoices.userId, userId),
    ),
  });
  if (!invoice) {
    throw new Error(`Entity not found: invoice_line/${lineId}`);
  }

  if (invoice.status !== "draft") {
    throw new Error(await tr("serverErrors", "api.desktop.draftOnlyEditLines"));
  }

  return { invoiceId: line.invoiceId, timeEntryId: line.timeEntryId ?? null };
}

/**
 * Opret en fakturalinje fra desktop — samme guards som tRPC's `createLine`.
 *
 * Den generiske create skrev `invoiceId` og `timeEntryId` direkte fra appen,
 * så et device-token kunne lægge en linje på en faktura i en anden
 * organisation (eller en sendt faktura) og pege den på en fremmed tidspost.
 * Nu: forældrefakturaen skal være brugerens/organisationens og en kladde,
 * en linket tidspost markeres faktureret tenant-scoped (kaster hvis den er
 * fremmed eller allerede faktureret), og totalen genberegnes atomisk.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function createInvoiceLine(
  data: Record<string, unknown>,
  userId: string,
  deviceId: string,
  orgId: string | null,
  localId: string,
): Promise<AcceptedResult> {
  const invoiceId = typeof data.invoiceId === "string" ? data.invoiceId : "";
  const invoice = invoiceId
    ? await db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, invoiceId),
          orgId
            ? eq(invoices.organizationId, orgId)
            : eq(invoices.userId, userId),
        ),
      })
    : undefined;
  if (!invoice) {
    throw new Error(`Entity not found: invoice/${invoiceId}`);
  }
  if (invoice.status !== "draft") {
    throw new Error(await tr("serverErrors", "invoices.draftOnlyAddLines"));
  }

  const timeEntryId =
    typeof data.timeEntryId === "string" && data.timeEntryId
      ? data.timeEntryId
      : null;
  // Samme krav som tRPC's createLine (z.string().uuid()).
  const taskId =
    typeof data.taskId === "string" && UUID_PATTERN.test(data.taskId)
      ? data.taskId
      : null;
  // Opgaven skal være org'ens egen (#750) — ellers kunne linjen pege på en
  // fremmed tenants opgave.
  await assertDesktopReferencesOwned("invoice_line", { taskId }, userId, orgId);
  const fields = cleanInvoiceLineUpdate(data);

  const inserted = await db.transaction(async (tx) => {
    if (timeEntryId) {
      const marked = await markEntriesBilled(
        tx,
        [timeEntryId],
        invoiceId,
        orgId,
        userId,
        invoice.clientId,
      );
      if (marked === 0)
        throw new Error(await tr("serverErrors", "invoices.timeEntryNotFound"));
    }
    const [row] = await tx
      .insert(invoiceLines)
      .values({
        ...fields,
        invoiceId,
        timeEntryId,
        taskId,
      } as typeof invoiceLines.$inferInsert)
      .returning({ id: invoiceLines.id });
    await recalcInvoiceTotal(tx, invoiceId);
    return row;
  });

  if (!inserted) {
    throw new Error("Kunne ikke oprette invoice_line");
  }

  await db.insert(desktopSyncLog).values({
    userId,
    deviceId,
    entityType: "invoice_line",
    entityId: inserted.id,
    action: "create",
  });

  return {
    localId,
    remoteId: inserted.id,
    type: "invoice_line",
    action: "create",
  };
}

/**
 * Kun beløbsfelterne må redigeres — samme sæt som tRPC's `updateLine`-input
 * (`invoices.ts:1655-1662`). `invoiceId` og `timeEntryId` er bevidst UDEN FOR:
 * ellers kunne appen godkende linjen mod sin egen faktura og så flytte den til
 * en faktura i en anden organisation, hvilket ville gå udenom
 * ejerskabskontrollen ovenfor.
 */
function cleanInvoiceLineUpdate(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  for (const field of [
    "description",
    "quantity",
    "unitPrice",
    "amount",
    "sortOrder",
  ]) {
    if (data[field] !== undefined) updateData[field] = data[field];
  }
  return updateData;
}

/**
 * POST /api/desktop/sync/push
 *
 * Push local changes from the desktop app to the server.
 *
 * Header: Authorization: Bearer <device-token>
 * Body: {
 *   entities: [
 *     { type: "client", action: "create", data: {...}, localId?: "...", localUpdatedAt: "..." },
 *     { type: "time_entry", action: "update", data: {...}, localUpdatedAt: "..." },
 *   ]
 * }
 *
 * Returns: { accepted: [...], conflicts: [...], errors: [...], serverTime: "..." }
 */
export async function POST(request: Request) {
  // Rate limit: 30 requests per minute per IP
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`sync-push:${ip}`, 30, 60_000))) {
    return rateLimitResponse();
  }

  try {
    const auth = await authenticateDevice(request);
    const { userId, deviceId } = auth;

    // Klientversion: spor i Sentry, og afvis skrivninger fra en desktop-app
    // under MIN_CLIENT_VERSIONS med HTTP 426 (ukendt version = tilladt).
    // Efter login, så afvisningen kan logges på brugeren.
    const client = resolveRequestClient(request.headers);
    Sentry.setTag("client.kind", client.kind ?? "desktop");
    Sentry.setTag("client.version", client.version ?? "ukendt");
    const tooOld = checkRestClientVersion(request.headers);
    if (tooOld) {
      await recordClientTooOld({
        db,
        headers: request.headers,
        path: "desktop.sync.push",
        error: tooOld,
        userId,
      });
      return NextResponse.json(clientTooOldBody(tooOld), { status: 426 });
    }

    // Resolve the user's org so desktop-created clients/projects/time/etc. get
    // organizationId — otherwise they'd be orphaned from the team (invisible in
    // the web app's org-scoped queries). Opslaget SKAL være deterministisk:
    // stempler vi en post med en tilfældig af brugerens orgs, havner den i en
    // fremmed organisations data. Se resolveDesktopOrgId.
    const orgId = await resolveDesktopOrgId(userId);
    if (!orgId) {
      return NextResponse.json(
        { error: orglessForbiddenMessage() },
        { status: 403 },
      );
    }

    const body = await request.json();
    const entities: SyncEntity[] = body.entities;

    if (!Array.isArray(entities)) {
      return NextResponse.json(
        { error: "entities must be an array" },
        { status: 400 },
      );
    }

    // Update device last sync time
    await db
      .update(desktopDevices)
      .set({ lastSyncAt: new Date() })
      .where(eq(desktopDevices.id, deviceId));

    const accepted: AcceptedResult[] = [];
    const conflicts: ConflictResult[] = [];
    const errors: EntityError[] = [];
    /** Lokalt id → server-id for de poster der blev oprettet i denne kørsel. */
    const idMap: Record<string, string> = {};

    for (const [index, entity] of entities.entries()) {
      // Én post må aldrig vælte hele batchen: en ugyldig enhed skal give en
      // fejl for netop den post, mens de gyldige stadig synker.
      if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
        errors.push({
          index,
          type: "unknown",
          error: "Entity must be an object",
        });
        continue;
      }

      const entityDef = getEntityTable(entity.type);
      if (!entityDef) {
        errors.push({
          index,
          localId: entity.localId,
          type: String(entity.type ?? "unknown"),
          action: entity.action,
          error: `Unknown entity type: ${entity.type}`,
        });
        continue;
      }

      // Nøglen er ikke valgfri i svaret: appens afkodning fejler på en batch,
      // hvis én post mangler den (se responseLocalId).
      const localId = responseLocalId(entity, index);

      try {
        if (entity.action === "create") {
          const result = await handleCreate(
            entity,
            entityDef,
            userId,
            deviceId,
            orgId,
            localId,
          );
          accepted.push(result);
          if (result.action === "create" && entity.localId) {
            idMap[entity.localId] = result.remoteId;
          }
        } else if (entity.action === "update") {
          const result = await handleUpdate(
            entity,
            entityDef,
            userId,
            deviceId,
            orgId,
            localId,
          );
          if ("reason" in result) {
            conflicts.push(result as ConflictResult);
          } else {
            accepted.push(result as AcceptedResult);
          }
        } else if (entity.action === "delete") {
          const result = await handleDelete(
            entity,
            entityDef,
            userId,
            deviceId,
            orgId,
            localId,
          );
          accepted.push(result);
        } else {
          errors.push({
            index,
            localId: entity.localId,
            type: entity.type,
            action: entity.action,
            error: `Unknown action: ${entity.action}`,
          });
        }
      } catch (err) {
        const rawRemoteId = entity.data?.remoteId ?? entity.data?.id;
        errors.push({
          index,
          localId: entity.localId,
          remoteId: typeof rawRemoteId === "string" ? rawRemoteId : undefined,
          type: entity.type,
          action: entity.action,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Åbne web-faner skal se desktop-ændringerne (tid, klippekort, fakturaer)
    // uden at vente på staleTime. Fire-and-forget.
    if (accepted.length > 0) {
      void publishDataChanged(userId, orgId, [
        ...new Set([...TIME_ENTRY_DOMAINS, ...INVOICE_DOMAINS]),
      ]);
    }

    return NextResponse.json({
      accepted,
      conflicts,
      errors,
      idMap,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    const authResponse = deviceAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error("[Desktop Sync Push] Error:", error);
    return NextResponse.json({ error: "Sync push failed" }, { status: 500 });
  }
}

async function handleCreate(
  entity: SyncEntity,
  entityDef: ReturnType<typeof getEntityTable> & {},
  userId: string,
  deviceId: string,
  orgId: string | null,
  localId: string,
): Promise<AcceptedResult> {
  const { data, type } = entity;
  const { table } = entityDef;

  if (type === "client" || type === "project") {
    const planTier = await resolvePlanTier({
      db,
      session: { user: { id: userId } },
      orgId,
    });
    const moduleKey = type === "client" ? "clients" : "projects";
    if (orgId) {
      const modules = await resolveModules(db, orgId);
      if (!modules.isEnabled(moduleKey)) {
        throw new Error(
          `Modulet "${moduleKey}" er ikke aktiveret for denne organisation.`,
        );
      }
      if (
        (await resolveModuleAccess(db, userId, orgId, moduleKey)) !== "write"
      ) {
        throw new Error("Din rolle har ikke adgang til denne handling");
      }
    }
    if (type === "client") {
      await assertCanAddActiveClient(db, { planTier, orgId, userId });
    }
  }

  if (type === "invoice_line") {
    return createInvoiceLine(data, userId, deviceId, orgId, localId);
  }

  // Kun de felter desktop må skrive (#750); userId + organizationId stemples
  // af serveren, og hvert refereret id skal tilhøre callerens org.
  let insertData = cleanDataForInsert(
    pickDesktopWritableFields(type, "create", data),
    type,
    userId,
    orgId,
  );
  await assertDesktopReferencesOwned(type, insertData, userId, orgId);

  // Klippekort-saldi er server-autoritative (#205): en pushet tidspost med
  // prepaid-flag skal gennem deductHoursCore (atomisk, row-lock) — og et
  // pushet klippekort må aldrig medbringe lokale saldo-værdier.
  let requestedPackageId: string | null = null;
  if (type === "time_entry") {
    // Desktop registrerer via en timer og sender startTime/endTime (evt.
    // duration) uden hours/date — begge er NOT NULL, så de udledes her.
    insertData = normalizeTimeEntryTiming(insertData);
    const sanitized = sanitizeTimeEntryPush(insertData);
    insertData = sanitized.clean;
    requestedPackageId = sanitized.requestedPackageId;
    // Intern klient (#541): uden eksplicit isBillable arves klientens default
    if (typeof insertData.isBillable !== "boolean") {
      insertData.isBillable = await resolveDefaultBillable(db, {
        projectId: (insertData.projectId as string | null | undefined) ?? null,
        clientId: (insertData.clientId as string | null | undefined) ?? null,
      });
    }
    // Fælles redigeringsguard (#467): periodelås, ugestatus, rullende lås
    await assertEntryEditable(db, {
      orgId,
      userId,
      dates: [insertData.date as Date | string],
    });
  } else if (type === "klippekort") {
    insertData = sanitizeKlippekortInsert(insertData);
  } else if (type === "invoice_draft") {
    // Som tRPC's invoices.create for kladder: status og nummer er serverens,
    // og kladder forbruger ikke numre af den fortløbende serie (#196).
    insertData.status = "draft";
    insertData.invoiceNumber = draftInvoiceNumber();
    // Beløbet ejes af linjerne (recalcInvoiceTotal); en ny kladde er tom.
    insertData.amount = "0";
  }

  // Postgres-`timestamp`-kolonner tager et `Date`, ikke en streng (#654).
  // cleanDataForInsert har allerede konverteret appens egne felter, men
  // `normalizeTimeEntryTiming` udleder `date` som "yyyy-MM-dd" bagefter — uden
  // endnu en konvertering kaster insertet på `value.toISOString`.
  insertData = withDates(insertData, type);

  // Idempotensnøgle fra appen (samme mønster som extension.createTimeEntry):
  // en gentagelse efter tabt svar rammer unique-indekset og returnerer den
  // eksisterende post i stedet for at indsætte en dublet. Kolonnen er UNIQUE
  // for hele tabellen, mens genfindelsen filtrerer på `userId`, så nøglen skal
  // afledes til ét navne rum pr. bruger og enhed — ellers kan to brugere med
  // samme lokale nøgle aldrig oprette hver sin post, og to enheder hos samme
  // bruger kan få hinandens `remoteId` (se scopeClientEntryId).
  //
  // Den afledte værdi er den der BÅDE gemmes og genfindes på; ellers ville
  // indekset og opslaget måle to forskellige ting, og en nøgle der ikke kan
  // bruges (for lang, ikke en streng) ville stå rå i kolonnen.
  const clientEntryId =
    type === "time_entry"
      ? scopeClientEntryId(insertData.clientEntryId, userId, deviceId)
      : null;
  if (clientEntryId) {
    insertData.clientEntryId = clientEntryId;
  } else {
    delete insertData.clientEntryId;
  }

  const inserted = await db.transaction(async (tx) => {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic table insert
    let query = tx.insert(table as any).values(insertData) as any;
    if (clientEntryId) {
      query = query.onConflictDoNothing({
        target: timeEntries.clientEntryId,
      });
    }
    const [row] = await query.returning();

    if (row && type === "time_entry" && requestedPackageId) {
      const hours = Number.parseFloat(String(insertData.hours ?? ""));
      if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error(
          await tr("serverErrors", "api.desktop.invalidPrepaidHours"),
        );
      }
      // Postens effektive kunde (#862, CodeRabbit PR #858): egen klient,
      // ellers projektets — deductHoursCore afviser et klippekort fra en
      // anden kunde.
      const entryClientId =
        (insertData.clientId as string | null | undefined) ??
        (await lookupProjectClientId(
          db,
          (insertData.projectId as string | null | undefined) ?? null,
        ));
      // Kaster ved ukendt/inaktiv pakke eller utilstrækkelig saldo — hele
      // transaktionen rulles tilbage og enheden får fejlen retur, så
      // desktop-appen ikke tror posten er accepteret som prepaid.
      await deductHoursCore(tx, userId, orgId, {
        packageId: requestedPackageId,
        hours,
        timeEntryId: row.id,
        clientId: entryClientId,
      });
    }

    return row;
  });

  if (!inserted) {
    // Dublet-indsendelse: posten findes allerede, så svar med dens id —
    // ellers ville appen prøve igen og få nye dubletter hver gang.
    const existing =
      clientEntryId && type === "time_entry"
        ? await db.query.timeEntries.findFirst({
            where: and(
              eq(timeEntries.clientEntryId, clientEntryId),
              eq(timeEntries.userId, userId),
            ),
            columns: { id: true },
          })
        : null;
    if (existing) {
      return { localId, remoteId: existing.id, type, action: "create" };
    }
    throw new Error(`Kunne ikke oprette ${type}`);
  }

  if (type === "time_entry") {
    trackEvent({
      userId,
      orgId,
      event: "time_entry.created",
      source: "desktop",
    });
  }

  // Log sync action
  await db.insert(desktopSyncLog).values({
    userId,
    deviceId,
    entityType: type,
    entityId: inserted.id,
    action: "create",
  });

  return {
    localId,
    remoteId: inserted.id,
    type,
    action: "create",
  };
}

async function handleUpdate(
  entity: SyncEntity,
  entityDef: ReturnType<typeof getEntityTable> & {},
  userId: string,
  deviceId: string,
  orgId: string | null,
  localId: string,
): Promise<AcceptedResult | ConflictResult> {
  const apply = (connection: UpdateConnection) =>
    handleUpdateOnConnection(
      entity,
      entityDef,
      userId,
      deviceId,
      orgId,
      localId,
      connection,
    );
  return entity.type === "time_entry" ? db.transaction(apply) : apply(db);
}

type UpdateConnection =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function handleUpdateOnConnection(
  entity: SyncEntity,
  entityDef: ReturnType<typeof getEntityTable> & {},
  userId: string,
  deviceId: string,
  orgId: string | null,
  localId: string,
  db: UpdateConnection,
): Promise<AcceptedResult | ConflictResult> {
  const { data, type, localUpdatedAt } = entity;
  const { table, idCol, userCol, updatedCol } = entityDef;

  // `id` når appen har server-id'et (fra `idMap`), ellers `remoteId` fra
  // appens cache, ellers det lokale id. Uden `remoteId`-fallbacket fejlede
  // enhver desktop-post der var hentet før første synk med "Entity not
  // found", selv om serveren havde den. Nøglen til opslaget er appens egen —
  // ikke den syntetiske svarnøglen, der aldrig kan finde en række.
  const remoteId = resolveSyncRemoteId(data, entity.localId);
  if (!remoteId) {
    throw new Error("Entity ID required for update");
  }

  if (type === "invoice_line") {
    // Egen sti: `invoice_lines` kan ikke slås op via den generiske
    // `userCol`-filtrering, fordi tabellen ingen `user_id` har. Ejerskabet
    // valideres på forældrefakturaen FØR nogen kolonne røres.
    const { invoiceId } = await authorizeInvoiceLine(remoteId, userId, orgId);

    await db.transaction(async (tx) => {
      await tx
        .update(invoiceLines)
        .set(cleanInvoiceLineUpdate(data))
        .where(eq(invoiceLines.id, remoteId));
      // `amount` er den eneste måde invoices.amount bliver sat, så en
      // redigeret linje uden denne efterlod et gammelt total: fakturaen og
      // mailede PDF'er talte om et beløb der ikke matchede linjerne.
      await recalcInvoiceTotal(tx, invoiceId);
    });

    await db.insert(desktopSyncLog).values({
      userId,
      deviceId,
      entityType: type,
      entityId: remoteId,
      action: "update",
    });

    return {
      localId,
      remoteId,
      type,
      action: "update",
    };
  }

  // Fetch current server version
  // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
  const conditions = [eq(idCol as any, remoteId)];
  if (userCol) {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
    conditions.push(eq(userCol as any, userId));
  }

  const query = db
    .select()
    // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
    .from(table as any)
    .where(and(...conditions));
  // Hold låsen fra versionskontrollen til timer og opgaveminutter er gemt.
  const [existing] = await (type === "time_entry"
    ? query.for("update")
    : query);

  if (type === "time_entry" && existing) {
    // Fælles redigeringsguard (#467): hverken gammel eller ny dato i låst
    // periode/uge. Den nye dato læses på den danske dag, som den gemmes.
    const entryRow = existing as {
      date?: Date | string;
      approvalStatus?: string | null;
    };
    await assertEntryEditable(db, {
      orgId,
      userId,
      dates: [
        entryRow.date,
        entryDateFromInput(data.date) ?? (data.date as string | undefined),
      ],
      entries: [{ approvalStatus: entryRow.approvalStatus ?? null }],
    });
  }

  if (!existing) {
    throw new Error(`Entity not found: ${type}/${remoteId}`);
  }

  // Kun kladder må redigeres (#750) — som tRPC's invoices.update.
  if (
    type === "invoice_draft" &&
    (existing as { status?: string | null }).status !== "draft"
  ) {
    throw new Error(
      await tr("serverErrors", "api.desktop.draftOnlyEditInvoices"),
    );
  }

  // Conflict detection: if server version is newer than local version
  if (updatedCol && localUpdatedAt && existing.updatedAt) {
    const serverTime = new Date(existing.updatedAt).getTime();
    const clientTime = new Date(localUpdatedAt).getTime();
    if (serverTime > clientTime) {
      return {
        localId,
        remoteId,
        type,
        reason: "Server version is newer",
        serverData: existing as Record<string, unknown>,
      };
    }
  }

  // Apply update. Tidsposter whitelistes først efter fakturalåsen, så et
  // forsøg på at ændre faktureringen af en låst post afvises frem for at
  // blive strippet i stilhed.
  let updateData = cleanDataForUpdate(data, type);
  if (type !== "time_entry") {
    updateData = pickDesktopWritableFields(type, "update", updateData);
    await assertDesktopReferencesOwned(type, updateData, userId, orgId);
  }

  // Server-autoritative klippekort-saldi (#205)
  if (type === "klippekort") {
    const pkgRow = existing as {
      usedHours?: string | null;
      hourlyRate?: string | null;
    };
    updateData = sanitizeKlippekortUpdate(
      updateData,
      pkgRow.usedHours ?? null,
      pkgRow.hourlyRate ?? null,
    );
  }

  if (type === "time_entry") {
    // Prepaid-flags må ikke skrives råt; reconcile trækket når timer eller
    // klient ændres (spejler time.update, #204). Desktop kan ikke vælge
    // pakke i sync — requestedPackageId er altid undefined her, så
    // klient-skift detacher som sikker default.
    const sanitized = sanitizeTimeEntryPush(updateData);
    updateData = sanitized.clean;

    // Flytter appen tidsrummet uden at sende `hours` med, følger timetallet
    // rummet — ellers stod den gamle `hours` oveni det nye rum.
    updateData = deriveHoursForTimeEntryUpdate(updateData);

    // En `date` appen sender med skal ligge på UTC-midnat, som alt andet.
    updateData = normalizeTimeEntryUpdateDate(updateData);

    // Fakturerede poster er låst (#702). Desktop sender hele rækken, så kun
    // felter der faktisk ændres tæller; lokale ekstra-felter ignoreres.
    const lockedRow = existing as Record<string, unknown> & {
      isBilled: boolean | null;
      invoiceId: string | null;
    };
    const columnPatch = Object.fromEntries(
      Object.entries(updateData).filter(([key]) => key in lockedRow),
    );
    assertBilledPatchAllowed(lockedRow, columnPatch);
    // Passerede en låst post, er kun noten ændret — skriv ikke resten af
    // rækken tilbage (fx et andet klokkeslæt på samme dag). Faktureringen
    // kan ikke ændres herfra (#750): en manuel markering fjernes i web-appen,
    // og appen får en fejl frem for et "accepteret" der ikke skete.
    if (isManualUnbill(lockedRow, columnPatch)) {
      throw new Error(await tr("serverErrors", "api.desktop.unbillOnlyWeb"));
    }
    if (isBilledLocked(lockedRow)) {
      updateData = "notes" in updateData ? { notes: updateData.notes } : {};
    } else {
      updateData = pickDesktopWritableFields(type, "update", updateData);
      await assertDesktopReferencesOwned(type, updateData, userId, orgId);
    }

    const entryRow = existing as {
      isPrepaid?: boolean | null;
      prepaidPackageId?: string | null;
      clientId?: string | null;
      projectId?: string | null;
      hours?: string | null;
      taskId?: string | null;
    };
    const oldPackageId = entryRow.prepaidPackageId ?? null;
    const wasPrepaid = !!entryRow.isPrepaid && !!oldPackageId;
    const oldHours = Number.parseFloat(entryRow.hours || "0");
    const newHours =
      updateData.hours !== undefined
        ? Number.parseFloat(String(updateData.hours))
        : oldHours;
    if (wasPrepaid && (!Number.isFinite(newHours) || newHours <= 0)) {
      throw new Error(
        await tr("serverErrors", "api.desktop.invalidPrepaidHours"),
      );
    }
    const newClientId =
      updateData.clientId !== undefined
        ? ((updateData.clientId as string | null) ?? null)
        : (entryRow.clientId ?? null);

    // Effektiv kunde (A1 P1-1): projektets kunde tæller med, så en post
    // gemt som klient+projekt ikke detaches når appen sender kun projektet.
    const oldProjectId = entryRow.projectId ?? null;
    const newProjectId =
      updateData.projectId !== undefined
        ? ((updateData.projectId as string | null) ?? null)
        : oldProjectId;
    const oldProjectClientId = wasPrepaid
      ? await lookupProjectClientId(db, oldProjectId)
      : null;
    const newProjectClientId =
      newProjectId === oldProjectId
        ? oldProjectClientId
        : wasPrepaid
          ? await lookupProjectClientId(db, newProjectId)
          : null;

    const decision = resolvePrepaidReconcile({
      wasPrepaid,
      oldPackageId,
      oldClient: {
        clientId: entryRow.clientId ?? null,
        projectClientId: oldProjectClientId,
      },
      newClient: { clientId: newClientId, projectClientId: newProjectClientId },
      requestedPackageId: undefined,
      oldHours,
      newHours,
    });
    const newEffectiveClientId = newClientId ?? newProjectClientId;

    // Reconcile OG felt-opdateringen skal committe atomisk — ellers kan
    // saldoen være trukket for de NYE timer mens hours-kolonnen stadig
    // holder den gamle værdi, hvis den rå update fejler bagefter.
    await db.transaction(async (tx) => {
      const oldTaskId = entryRow.taskId ?? null;
      const newTaskId =
        updateData.taskId !== undefined
          ? (updateData.taskId as string | null)
          : oldTaskId;
      if (oldTaskId !== newTaskId || oldHours !== newHours) {
        if (oldTaskId) {
          await tx
            .update(tasks)
            .set({
              actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) - ${Math.round(oldHours * 60)})`,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, oldTaskId));
        }
        if (newTaskId) {
          await tx
            .update(tasks)
            .set({
              actualMinutes: sql`COALESCE(${tasks.actualMinutes}, 0) + ${Math.round(newHours * 60)}`,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, newTaskId));
        }
      }
      if (decision.needsReconcile) {
        // I et savepoint: en sync må aldrig sidde fast i genforsøg fordi
        // kortet ikke kan dække opskrivningen (blok-kort, udløbet). Fejler
        // afstemningen, gemmes rækken alligevel og det oprindelige træk
        // bevares — samme udfald som et timer-stop i web.
        await withPrepaidSavepoint(
          tx,
          async (sp) => {
            if (wasPrepaid && oldPackageId) {
              await reversePrepaidUsage(sp, remoteId, oldPackageId);
            }
            if (decision.targetPackageId) {
              await deductHoursCore(sp, userId, orgId, {
                packageId: decision.targetPackageId,
                hours: newHours,
                timeEntryId: remoteId,
                allowInactive: decision.allowInactive,
                clientId: newEffectiveClientId,
              });
            } else {
              await sp
                .update(timeEntries)
                .set({ isPrepaid: false, prepaidPackageId: null })
                .where(eq(timeEntries.id, remoteId));
            }
          },
          "desktop-push",
        );
      }
      await tx
        // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
        .update(table as any)
        .set({ ...updateData, updatedAt: new Date() })
        // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
        .where(eq(idCol as any, remoteId));
    });

    await db.insert(desktopSyncLog).values({
      userId,
      deviceId,
      entityType: type,
      entityId: remoteId,
      action: "update",
    });

    return {
      localId,
      remoteId,
      type,
      action: "update",
    };
  }

  // En kladde kan være sendt mellem tjekket ovenfor og skrivningen — derfor
  // står kladde-kravet også i WHERE.
  // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
  const updateWhere = [eq(idCol as any, remoteId)];
  if (type === "invoice_draft") updateWhere.push(eq(invoices.status, "draft"));
  await db
    // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
    .update(table as any)
    .set({ ...updateData, updatedAt: new Date() })
    .where(and(...updateWhere));

  // Log sync action
  await db.insert(desktopSyncLog).values({
    userId,
    deviceId,
    entityType: type,
    entityId: remoteId,
    action: "update",
  });

  return {
    localId,
    remoteId,
    type,
    action: "update",
  };
}

async function handleDelete(
  entity: SyncEntity,
  entityDef: ReturnType<typeof getEntityTable> & {},
  userId: string,
  deviceId: string,
  orgId: string | null,
  localId: string,
): Promise<AcceptedResult> {
  const { data, type } = entity;
  const { table, idCol, userCol } = entityDef;

  const remoteId = resolveSyncRemoteId(data, entity.localId);
  if (!remoteId) {
    throw new Error("Entity ID required for delete");
  }

  // Redigeringsguard (#467): sletning af tid i låst periode/uge afvises
  if (type === "time_entry") {
    const existing = await db.query.timeEntries.findFirst({
      where: eq(timeEntries.id, remoteId),
      columns: {
        date: true,
        userId: true,
        isBilled: true,
        invoiceId: true,
        approvalStatus: true,
      },
    });
    if (existing && existing.userId === userId) {
      // Fakturerede poster kan ikke slettes (#702)
      assertEntryNotBilled(existing);
      await assertEntryEditable(db, {
        orgId,
        userId,
        dates: [existing.date],
        entries: [{ approvalStatus: existing.approvalStatus ?? null }],
      });
    }
  }

  // Soft delete (archive) where possible — domain rule: archive over delete
  // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
  const conditions = [eq(idCol as any, remoteId)];
  if (userCol) {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
    conditions.push(eq(userCol as any, userId));
  }

  // Most tables have isArchived; use it. For invoice_lines, hard delete.
  if (type === "invoice_line") {
    // En hard delete på en penge-række. Uden ejerskabs- og statusguard kunne
    // et device-token slette linjer i en vilkårlig organisation og på en sendt
    // faktura, og fakturaen ville stå med et gammelt total.
    const { invoiceId, timeEntryId } = await authorizeInvoiceLine(
      remoteId,
      userId,
      orgId,
    );

    await db.transaction(async (tx) => {
      // Frigiv tidsposten så den kan faktureres igen — samme som tRPC.
      if (timeEntryId) {
        await releaseEntries(tx, [timeEntryId]);
      }
      await tx.delete(invoiceLines).where(eq(invoiceLines.id, remoteId));
      await recalcInvoiceTotal(tx, invoiceId);
    });
    await recordSyncTombstone(db, {
      entityType: type,
      entityId: remoteId,
      userId,
      organizationId: orgId,
    });
  } else if (type === "time_entry") {
    await hardDeleteTimeEntry(remoteId, userId, orgId);
  } else if (!ARCHIVABLE_TYPES.has(type)) {
    // Ruten skrev isArchived på alle typer, men kun `clients` og
    // `prepaid_packages` har en `is_archived`-kolonne — for de øvrige typer
    // afviste Postgres statementet, så sletningen fejlede pr. post.
    throw new Error(
      `Delete is not supported for entity type "${type}" from the desktop app`,
    );
  } else {
    const archived = await db
      // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
      .update(table as any)
      .set({ isArchived: true, updatedAt: new Date() } as Record<
        string,
        unknown
      >)
      .where(and(...conditions))
      // biome-ignore lint/suspicious/noExplicitAny: dynamic table query
      .returning({ id: idCol as any });
    // Kun en række enheden faktisk ejer, må give en tombstone — ellers kunne
    // et id på en kollegas (eller ingens) række få alle enheder i
    // organisationen til at slette den lokalt.
    if (archived.length === 0) {
      throw new Error(`Entity not found: ${type}/${remoteId}`);
    }
    await recordSyncTombstone(db, {
      entityType: type,
      entityId: remoteId,
      userId,
      organizationId: orgId,
    });
  }

  // Log sync action
  await db.insert(desktopSyncLog).values({
    userId,
    deviceId,
    entityType: type,
    entityId: remoteId,
    action: "delete",
  });

  return {
    localId,
    remoteId,
    type,
    action: "delete",
  };
}

/**
 * Hard delete af en tidspost — samme domæneadfærd som `time.delete` i tRPC
 * (time.ts:1530): frigiv klippekort, returér fakturering af genererede
 * linjer, træk den indregulerede tid fra opgaven og fjern rækken.
 *
 * `time_entries` har ingen `is_archived`-kolonne (kun `clients` og
 * `prepaid_packages` har), så den generiske arkiveringssti gav en Postgres
 * fejl på hver sletning fra skrivebordet. En hard delete efterlader intet at
 * pulle, derfor skrives en tombstone — ellers bliver den slettede post liggende
 * på alle andre enheder, og næste redigering af den fejler for evigt.
 */
async function hardDeleteTimeEntry(
  remoteId: string,
  userId: string,
  orgId: string | null,
): Promise<void> {
  const existing = await db.query.timeEntries.findFirst({
    where: and(eq(timeEntries.id, remoteId), eq(timeEntries.userId, userId)),
  });
  if (!existing) {
    throw new Error(
      await tr("serverErrors", "api.desktop.entryNotFoundOrOther", {
        id: remoteId,
      }),
    );
  }

  await db.transaction(async (tx) => {
    if (existing.taskId) {
      const minutesToRemove = Math.round(Number(existing.hours) * 60);
      await tx
        .update(tasks)
        .set({
          actualMinutes: sql`GREATEST(0, COALESCE(${tasks.actualMinutes}, 0) - ${minutesToRemove})`,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, existing.taskId));
    }

    if (existing.isPrepaid && existing.prepaidPackageId) {
      await reversePrepaidUsage(tx, remoteId, existing.prepaidPackageId);
    }

    await tx
      .delete(generatedTimeEntries)
      .where(eq(generatedTimeEntries.timeEntryId, remoteId));
    await tx.delete(prepaidUsage).where(eq(prepaidUsage.timeEntryId, remoteId));
    await tx
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, remoteId), eq(timeEntries.userId, userId)));
  });

  // Tombstone EFTER commit, på den ydre db: Postgres afbryder transaktionen
  // ved et fejlet statement, så en insert der kaster (0128 ikke kørt) ville
  // rulle sletningen tilbage — og desktop fik alligevel `success`.
  await recordSyncTombstone(db, {
    entityType: "time_entry",
    entityId: remoteId,
    userId,
    organizationId: orgId,
  });
}

/**
 * Clean incoming data for insert: remove local-only fields, inject userId.
 */
function cleanDataForInsert(
  data: Record<string, unknown>,
  type: string,
  userId: string,
  orgId: string | null,
): Record<string, unknown> {
  // Remove fields that should be server-generated
  const { localId, synced, syncedAt, ...rest } = data;

  const clean: Record<string, unknown> = { ...rest };

  // Always set userId for top-level entities; also stamp organizationId so the
  // entity belongs to the team (invoice_line has neither — it's a child row).
  if (type !== "invoice_line") {
    clean.userId = userId;
    clean.organizationId = orgId;
  }

  // Serveren genererer altid id'et ved create: appens lokale id er ikke et
  // gyldigt uuid (SQLite-rækkenummer), og et gyldigt uuid fra en tidligere
  // synk ville kollidere med den post, appen sender en update på. Det
  // server-id appen skal bruge kommer retur i `idMap`/accepted.
  delete clean.id;

  return withDates(withEntryDate(clean, type), type);
}

/**
 * Clean incoming data for update: remove immutable fields.
 */
function cleanDataForUpdate(
  data: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  const {
    id,
    userId,
    organizationId,
    localId,
    synced,
    syncedAt,
    createdAt,
    ...rest
  } = data;
  // organizationId er serverens (sat ved create): en update må ikke kunne
  // flytte en række til en anden organisation.
  const clean = { ...rest };
  if (type === "time_entry") {
    // Samme lokale felter som på create: de er ikke kolonner, så lader vi dem
    // stå ville hver update med dem fejle på en ukendt kolonne. `remoteId` er
    // især vigtig at fjerne her — den bruges nu til at slå posten op på, men
    // den må ikke skrives i tabellen.
    for (const field of TIME_ENTRY_LOCAL_FIELDS) delete clean[field];
    // Idempotensnøglen hører til create: den afledes af bruger og enhed, så
    // en update der skrev appens rå lokale nøgle ville både ramme det globale
    // unique-indeks ved en senere gentagelse og gøre posten ufindelig for
    // genfindelsen (den leder på den afledte værdi).
    delete clean.clientEntryId;
  }
  return withDates(withEntryDate(clean, type), type);
}

/**
 * Læs en tidsposts `date` på den danske dag FØR den generiske
 * tidsstempel-konvertering: `new Date("2026-07-16T23:30:00")` (vægur uden
 * zone) læses i processens tidszone og ville give 17/7 under TZ=UTC.
 */
function withEntryDate(
  data: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  if (type !== "time_entry" || data.date == null) return data;
  const parsed = entryDateFromInput(data.date);
  return parsed ? { ...data, date: parsed } : data;
}

function withDates(
  data: Record<string, unknown>,
  type: string,
): Record<string, unknown> {
  const table = getEntityTable(type)?.table;
  return table ? coerceTimestampFields(data, table) : data;
}
