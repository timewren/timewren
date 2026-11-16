import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { orglessForbiddenMessage } from "@/lib/auth/orgless";
import { clientLimitMessage } from "@/lib/billing/plan-limits";
import {
  clients,
  companyProfiles,
  deviceImportMap,
  invoiceLines,
  invoices,
  prepaidPackages,
} from "@/lib/db/schema";
import { sumMoney } from "@/lib/format";
import { publishDataChanged } from "@/lib/realtime";
import { router } from "../../trpc";
import {
  type DeviceAuth,
  deviceProcedure,
  type WebCaller,
  type WebInputs,
  webInput,
} from "./device-procedure";
import { RULE_KINDS, RULES_DOMAIN, upsertDeviceRules } from "./rules";

/**
 * Lokal → cloud-import (spec A5/D7): ét klik flytter en lokal desktop-
 * database op i den nye konto.
 *
 * - Alt oprettes gennem web's egne procedurer (clients.create,
 *   projects.create, prepaid.create, time.create, invoices.create), så
 *   plan-grænser, timepris-hierarki, klippekort-træk og nummerserie er
 *   web's. Ingen ny forretningslogik.
 * - Idempotent: `device_import_map` husker lokalt id → server-id, og
 *   poster sendes med en `clientEntryId` afledt af org + lokalt id. Et gentaget eller
 *   afbrudt kald opretter intet to gange, så klienten kan sende store
 *   databaser i bidder (kunder/projekter/klippekort igen, poster i bidder).
 * - `dryRun` opretter intet og returnerer samme rapport med det, der VILLE
 *   ske, inkl. hvad planen ikke tillader.
 * - Rå aktivitet importeres aldrig (D3).
 * - Opgaver, regler og fakturalinjer går også gennem web's procedurer
 *   (tasks.create, saveLines) eller reglernes egen upsert.
 */

const localId = z.string().trim().min(1).max(64);

/**
 * `clientEntryId` for en importeret post: deterministisk ud fra org, bruger
 * og lokalt id. Kolonnen er globalt unik, så det lokale id kan ikke bruges
 * direkte (samme lokale database importeret i to orgs ville kollidere), men
 * et gentaget kald i samme org giver samme nøgle, og web's time.create
 * returnerer den eksisterende post.
 */
export function importClientEntryId(
  orgId: string,
  userId: string,
  local: string,
): string {
  const h = createHash("sha256")
    .update(`device-import:${orgId}:${userId}:${local}`)
    .digest("hex");
  // UUID-form (version 5-bits, RFC 4122-variant), som zod's uuid() godtager.
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `5${h.slice(13, 16)}`,
    `${((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

const importInput = z.object({
  dryRun: z.boolean().default(true),
  clients: z
    .array(
      z.object({
        localId,
        isArchived: z.boolean().optional(),
        data: webInput<WebInputs["clients"]["create"]>(),
      }),
    )
    .max(1000)
    .default([]),
  projects: z
    .array(
      z.object({
        localId,
        clientLocalId: localId.nullable().optional(),
        data: webInput<Omit<WebInputs["projects"]["create"], "clientId">>(),
      }),
    )
    .max(2000)
    .default([]),
  prepaidPackages: z
    .array(
      z.object({
        localId,
        clientLocalId: localId,
        /**
         * Arkivér kortet efter kaldets poster. Ved import i bidder: send det
         * kun i det sidste kald, for et arkiveret kort kan ikke trækkes på.
         */
        isArchived: z.boolean().optional(),
        data: webInput<Omit<WebInputs["prepaid"]["create"], "clientId">>(),
      }),
    )
    .max(1000)
    .default([]),
  tasks: z
    .array(
      z.object({
        localId,
        projectLocalId: localId.nullable().optional(),
        clientLocalId: localId.nullable().optional(),
        data: webInput<
          Omit<WebInputs["tasks"]["create"], "projectId" | "clientId">
        >(),
      }),
    )
    .max(2000)
    .default([]),
  entries: z
    .array(
      z.object({
        localId,
        projectLocalId: localId.nullable().optional(),
        clientLocalId: localId.nullable().optional(),
        prepaidLocalId: localId.nullable().optional(),
        taskLocalId: localId.nullable().optional(),
        data: webInput<
          Omit<
            WebInputs["time"]["create"],
            | "projectId"
            | "clientId"
            | "prepaidPackageId"
            | "clientEntryId"
            | "taskId"
          >
        >(),
      }),
    )
    .max(2000)
    .default([]),
  rules: z
    .array(
      z.object({
        localId,
        kind: z.enum(RULE_KINDS),
        pattern: z.string().trim().min(1).max(500),
        projectLocalId: localId.nullable().optional(),
        clientLocalId: localId.nullable().optional(),
        /** "Ikke arbejde" (uden projekt og kunde). */
        notWork: z.boolean().optional(),
        usageCount: z.number().int().min(0).max(1_000_000).optional(),
        lastUsedAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .max(2000)
    .default([]),
  invoices: z
    .array(
      z.object({
        localId,
        clientLocalId: localId,
        entryLocalIds: z.array(localId).max(5000).optional(),
        /** Det lokale fakturanummer (web tildeler sit eget). */
        invoiceNumber: z.string().max(50).optional(),
        /**
         * Kreditnota (beløb ≤ 0) til den lokale faktura med dette id. Bliver
         * en rigtig kreditnota via web's createCreditNote: fuld kreditering
         * (beløbet skal være originalens med modsat fortegn), nummer fra
         * serien, negerede linjer, originalen udlignet. Posterne bliver på
         * originalen. `data` bruges kun til beløbet; `lines` ignoreres.
         */
        creditNoteForLocalId: localId.optional(),
        paidDate: z.string().max(30).optional(),
        /**
         * Fakturalinjer. Summen skal være fakturaens `amount`. En linje med
         * `entryLocalId` knytter posten til fakturaen via linjen.
         */
        lines: z
          .array(
            z.object({
              description: z.string().trim().min(1).max(1000),
              quantity: z.string().max(20),
              unitPrice: z.string().max(20),
              amount: z.string().max(20),
              entryLocalId: localId.nullable().optional(),
            }),
          )
          .max(1000)
          .optional(),
        data: webInput<
          Omit<WebInputs["invoices"]["create"], "clientId" | "timeEntryIds">
        >(),
      }),
    )
    .max(500)
    .default([]),
});

type ImportInput = z.infer<typeof importInput>;
type Entity =
  | "client"
  | "project"
  | "prepaid"
  | "task"
  | "entry"
  | "rule"
  | "invoice";

interface EntityReport {
  total: number;
  /** Oprettet nu (eller ville blive det ved dry-run). */
  created: number;
  /** Allerede importeret i et tidligere kald. */
  existing: number;
  failed: number;
}

interface ImportError {
  entity: Entity;
  localId: string;
  message: string;
}

const MAX_ERRORS = 200;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : st("common.unknownError");
}

class ImportRun {
  readonly ids: Record<Entity, Map<string, string>>;
  readonly report: Record<Entity, EntityReport>;
  readonly errors: ImportError[] = [];
  errorCount = 0;

  constructor(
    readonly ctx: {
      db: typeof import("@/lib/db").db;
      web: WebCaller;
      device: DeviceAuth;
    },
    readonly orgId: string,
    readonly dryRun: boolean,
    existing: Array<{ entity: string; localId: string; serverId: string }>,
  ) {
    const empty = () => ({ total: 0, created: 0, existing: 0, failed: 0 });
    this.report = {
      client: empty(),
      project: empty(),
      prepaid: empty(),
      task: empty(),
      entry: empty(),
      rule: empty(),
      invoice: empty(),
    };
    this.ids = {
      client: new Map(),
      project: new Map(),
      prepaid: new Map(),
      task: new Map(),
      entry: new Map(),
      rule: new Map(),
      invoice: new Map(),
    };
    for (const row of existing) {
      this.ids[row.entity as Entity]?.set(row.localId, row.serverId);
    }
  }

  fail(entity: Entity, id: string, message: string) {
    this.report[entity].failed += 1;
    this.errorCount += 1;
    if (this.errors.length < MAX_ERRORS) {
      this.errors.push({ entity, localId: id, message });
    }
  }

  /**
   * Opslag af en reference (lokalt id → server-id). Ved dry-run tæller en
   * reference til noget, der ville blive oprettet, som fundet.
   */
  ref(entity: Entity, id: string | null | undefined): string | null {
    if (!id) return null;
    return this.ids[entity].get(id) ?? null;
  }

  /**
   * Opret ét element (eller spring over / simulér). Koblingen lokalt id →
   * server-id gemmes, så snart elementet findes på serveren, og først
   * derefter køres `followUp` (fx arkivering eller "betalt"). Fejler
   * opfølgningen, ved et nyt forsøg stadig, at elementet findes, så der
   * aldrig oprettes en dublet (for fakturaer: et nyt fakturanummer).
   * Opfølgningen køres også for elementer, der findes i forvejen, så en
   * fejlet opfølgning gennemføres ved næste forsøg. Den skal derfor selv
   * springe over, når den allerede er sket.
   */
  async one(
    entity: Entity,
    id: string,
    create: () => Promise<string>,
    blocked?: string | null,
    followUp?: (serverId: string) => Promise<unknown>,
  ): Promise<void> {
    const rep = this.report[entity];
    rep.total += 1;
    const known = this.ids[entity].get(id);
    if (known) {
      rep.existing += 1;
      if (followUp && !this.dryRun && !known.startsWith("dry-run:")) {
        await this.runFollowUp(entity, id, known, followUp);
      }
      return;
    }
    if (blocked) {
      this.fail(entity, id, blocked);
      return;
    }
    if (this.dryRun) {
      rep.created += 1;
      this.ids[entity].set(id, `dry-run:${id}`);
      return;
    }
    let serverId: string;
    try {
      serverId = await this.remember(entity, id, await create());
    } catch (err) {
      this.fail(entity, id, errorMessage(err));
      return;
    }
    this.ids[entity].set(id, serverId);
    rep.created += 1;
    if (followUp) await this.runFollowUp(entity, id, serverId, followUp);
  }

  private async runFollowUp(
    entity: Entity,
    id: string,
    serverId: string,
    followUp: (serverId: string) => Promise<unknown>,
  ) {
    try {
      await followUp(serverId);
    } catch (err) {
      // Elementet findes og er koblet; kun opfølgningen mangler.
      this.fail(entity, id, errorMessage(err));
    }
  }

  /**
   * Gem koblingen. Har et samtidigt kald allerede koblet samme lokale id,
   * bruges dens server-id, så resten af importen peger samme sted hen.
   */
  private async remember(
    entity: Entity,
    localId: string,
    serverId: string,
  ): Promise<string> {
    const scope = and(
      eq(deviceImportMap.organizationId, this.orgId),
      eq(deviceImportMap.userId, this.ctx.device.userId),
      eq(deviceImportMap.entity, entity),
      eq(deviceImportMap.localId, localId),
    );
    const [inserted] = await this.ctx.db
      .insert(deviceImportMap)
      .values({
        userId: this.ctx.device.userId,
        organizationId: this.orgId,
        entity,
        localId,
        serverId,
      })
      .onConflictDoNothing()
      .returning({ serverId: deviceImportMap.serverId });
    if (inserted) return inserted.serverId;
    const [row] = await this.ctx.db
      .select({ serverId: deviceImportMap.serverId })
      .from(deviceImportMap)
      .where(scope);
    return row?.serverId ?? serverId;
  }
}

/** Mangler en reference, hvis et lokalt id er angivet, men ikke importeret. */
function missingRef(
  run: ImportRun,
  entity: Entity,
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return run.ref(entity, id)
    ? null
    : st(`ext.import.refMissing.${entity}`, { id });
}

async function runImport(
  ctx: { db: typeof import("@/lib/db").db; web: WebCaller; device: DeviceAuth },
  input: ImportInput,
) {
  const orgId = ctx.device.orgId;
  if (!orgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: orglessForbiddenMessage(),
    });
  }
  const existing = await ctx.db
    .select({
      entity: deviceImportMap.entity,
      localId: deviceImportMap.localId,
      serverId: deviceImportMap.serverId,
    })
    .from(deviceImportMap)
    .where(
      and(
        eq(deviceImportMap.organizationId, orgId),
        eq(deviceImportMap.userId, ctx.device.userId),
      ),
    );
  const run = new ImportRun(ctx, orgId, input.dryRun, existing);

  // Opfølgninger springer over, når de allerede er sket, fordi de også
  // køres for elementer fra et tidligere forsøg.
  const archiveClient = async (id: string) => {
    const row = await ctx.db.query.clients.findFirst({
      where: and(eq(clients.id, id), eq(clients.organizationId, orgId)),
      columns: { isArchived: true },
    });
    if (row?.isArchived) return;
    await ctx.web.clients.archive({ id });
  };
  const markInvoicePaid = async (id: string, paidDate?: string) => {
    const row = await ctx.db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.organizationId, orgId)),
      columns: { status: true },
    });
    if (row?.status === "paid") return;
    await ctx.web.invoices.update({ id, status: "paid", paidDate });
  };

  // Kun til dry-run-rapportens plan-felt; web håndhæver selv kundeloftet.
  const details = await ctx.web.subscription.getDetails();
  const tier = details ? (details.isFree ? "free" : details.planTier) : null;
  // Web kræver virksomhedsoplysninger før org'ens første faktura.
  const missingCompanyProfile =
    input.dryRun && input.invoices.length > 0
      ? !(await ctx.db.query.companyProfiles.findFirst({
          where: eq(companyProfiles.organizationId, orgId),
          columns: { id: true },
        })) &&
        !(await ctx.db.query.invoices.findFirst({
          where: eq(invoices.organizationId, orgId),
          columns: { id: true },
        }))
      : false;
  let activeCapacity =
    details?.limits.maxActiveClients == null
      ? Number.POSITIVE_INFINITY
      : details.limits.maxActiveClients - details.usage.activeClients;

  // 1. Kunder: arkiverede først (de tæller ikke mod Gratis' loft, når de
  // arkiveres med det samme), så de aktive.
  const clientsSorted = [...input.clients].sort(
    (a, b) => Number(!a.isArchived) - Number(!b.isArchived),
  );
  for (const c of clientsSorted) {
    let blocked: string | null = null;
    if (run.dryRun && !run.ids.client.has(c.localId)) {
      if (activeCapacity <= 0) blocked = clientLimitMessage(tier);
      else if (!c.isArchived) activeCapacity -= 1;
    }
    await run.one(
      "client",
      c.localId,
      async () => (await ctx.web.clients.create(c.data)).id,
      blocked,
      c.isArchived ? archiveClient : undefined,
    );
  }

  // 2. Projekter (status som i den lokale database, fx "archived").
  for (const p of input.projects) {
    await run.one(
      "project",
      p.localId,
      async () => {
        const created = await ctx.web.projects.create({
          ...p.data,
          clientId: run.ref("client", p.clientLocalId),
        });
        return created.id;
      },
      missingRef(run, "client", p.clientLocalId),
    );
  }

  // 3. Klippekort.
  for (const k of input.prepaidPackages) {
    await run.one(
      "prepaid",
      k.localId,
      async () => {
        const clientId = run.ref("client", k.clientLocalId) as string;
        const created = await ctx.web.prepaid.create({ ...k.data, clientId });
        return created.id;
      },
      missingRef(run, "client", k.clientLocalId),
    );
  }

  // 3b. Opgaver (på projekt og/eller kunde).
  for (const t of input.tasks) {
    await run.one(
      "task",
      t.localId,
      async () => {
        const created = await ctx.web.tasks.create({
          ...t.data,
          projectId: run.ref("project", t.projectLocalId) ?? undefined,
          clientId: run.ref("client", t.clientLocalId) ?? undefined,
        });
        return created.id;
      },
      missingRef(run, "project", t.projectLocalId) ??
        missingRef(run, "client", t.clientLocalId),
    );
  }

  // 4. Poster: web's time.create sætter timepris og trækker klippekort.
  for (const e of input.entries) {
    await run.one(
      "entry",
      e.localId,
      async () => {
        const created = await ctx.web.time.create({
          ...e.data,
          projectId: run.ref("project", e.projectLocalId) ?? undefined,
          clientId: run.ref("client", e.clientLocalId) ?? undefined,
          prepaidPackageId: run.ref("prepaid", e.prepaidLocalId) ?? undefined,
          taskId: run.ref("task", e.taskLocalId) ?? undefined,
          clientEntryId: importClientEntryId(
            run.orgId,
            ctx.device.userId,
            e.localId,
          ),
        });
        return created.id;
      },
      missingRef(run, "project", e.projectLocalId) ??
        missingRef(run, "client", e.clientLocalId) ??
        missingRef(run, "prepaid", e.prepaidLocalId) ??
        missingRef(run, "task", e.taskLocalId),
    );
  }

  // 4b. Regler (bekræftede koblinger): idempotente pr. type og mønster.
  let rulesCreated = false;
  for (const r of input.rules) {
    const projectId = run.ref("project", r.projectLocalId);
    const clientId = run.ref("client", r.clientLocalId);
    await run.one(
      "rule",
      r.localId,
      async () => {
        const [row] = await upsertDeviceRules(ctx.db, ctx.device, [
          {
            kind: r.kind,
            pattern: r.pattern,
            projectId,
            clientId,
            notWork: r.notWork,
            source: "desktop",
            usageCount: r.usageCount,
            lastUsedAt: r.lastUsedAt,
          },
        ]);
        rulesCreated = true;
        return row.id;
      },
      missingRef(run, "project", r.projectLocalId) ??
        missingRef(run, "client", r.clientLocalId) ??
        (r.notWork
          ? r.projectLocalId || r.clientLocalId
            ? st("ext.import.noWorkRuleNoTarget")
            : null
          : !r.projectLocalId && !r.clientLocalId
            ? st("ext.import.ruleNeedsTarget")
            : null),
    );
  }
  if (rulesCreated)
    void publishDataChanged(ctx.device.userId, orgId, [RULES_DOMAIN]);

  // 5. Fakturaer: web tildeler nummer fra org'ens serie; det lokale nummer
  // står i noten. Betalte oprettes som sendt og markeres betalt. Med linjer
  // oprettes fakturaen som kladde, linjerne gemmes med web's saveLines (der
  // knytter linjernes poster til fakturaen), og den udstedes bagefter.
  const finishWithLines = async (
    id: string,
    inv: ImportInput["invoices"][number],
    status: string,
  ) => {
    const lines = inv.lines ?? [];
    const row = await ctx.db.query.invoices.findFirst({
      where: and(eq(invoices.id, id), eq(invoices.organizationId, orgId)),
      columns: { status: true },
    });
    if (!row) return;
    if (row.status === "draft") {
      const existingLine = await ctx.db.query.invoiceLines.findFirst({
        where: eq(invoiceLines.invoiceId, id),
        columns: { id: true },
      });
      if (!existingLine) {
        await ctx.web.invoices.saveLines({
          invoiceId: id,
          lines: lines.map((l, i) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            timeEntryId: run.ref("entry", l.entryLocalId),
            sortOrder: i,
          })),
        });
      }
      if (status === "draft") return;
      await ctx.web.invoices.update({ id, status: "sent" });
    }
    if (status === "overdue" && row.status !== "overdue") {
      await ctx.web.invoices.update({ id, status: "overdue" });
    }
    if (status === "paid") await markInvoicePaid(id, inv.paidDate);
  };

  const creditNotes = input.invoices.filter((inv) => inv.creditNoteForLocalId);
  for (const inv of input.invoices) {
    if (inv.creditNoteForLocalId) continue;
    const lines = inv.lines ?? [];
    const lineEntryLocalIds = new Set(
      lines.flatMap((l) => (l.entryLocalId ? [l.entryLocalId] : [])),
    );
    // Poster på en linje knyttes af linjen; de øvrige af selve fakturaen.
    const entryLocalIds = (inv.entryLocalIds ?? []).filter(
      (id) => !lineEntryLocalIds.has(id),
    );
    const entryIds = entryLocalIds.map((id) => run.ref("entry", id));
    const missingEntry =
      entryLocalIds.find((_, i) => !entryIds[i]) ??
      [...lineEntryLocalIds].find((id) => !run.ref("entry", id));
    const status = inv.data.status ?? "draft";
    const linesSum = lines.length ? sumMoney(lines.map((l) => l.amount)) : null;
    const wrongSum =
      linesSum !== null && linesSum !== Number(inv.data.amount)
        ? st("ext.import.linesSumMismatch", {
            sum: linesSum.toFixed(2),
            amount: inv.data.amount,
          })
        : null;
    await run.one(
      "invoice",
      inv.localId,
      async () => {
        const note = inv.invoiceNumber
          ? `Importeret fra TimeTrack Desktop, lokalt fakturanummer ${inv.invoiceNumber}.`
          : null;
        const created = await ctx.web.invoices.create({
          ...inv.data,
          status: lines.length ? "draft" : status === "paid" ? "sent" : status,
          clientId: run.ref("client", inv.clientLocalId) as string,
          timeEntryIds: entryIds.length ? (entryIds as string[]) : undefined,
          notes:
            [inv.data.notes, note].filter(Boolean).join("\n\n") || undefined,
        });
        return created.id;
      },
      missingRef(run, "client", inv.clientLocalId) ??
        (missingEntry
          ? st("ext.import.entryNotImported", { id: missingEntry })
          : null) ??
        wrongSum ??
        (missingCompanyProfile ? st("ext.import.companyProfileMissing") : null),
      lines.length
        ? (id) => finishWithLines(id, inv, status)
        : status === "paid"
          ? (id) => markInvoicePaid(id, inv.paidDate)
          : undefined,
    );
  }

  // 5b. Kreditnotaer efter fakturaerne, så originalen findes.
  const cents = (amount: string | number) => Math.round(Number(amount) * 100);
  for (const inv of creditNotes) {
    const originalLocalId = inv.creditNoteForLocalId as string;
    const amount = cents(inv.data.amount);
    const fullCredit = (originalAmount: string) =>
      cents(originalAmount) === -amount
        ? null
        : st("ext.import.fullCreditOnly", {
            amount: inv.data.amount,
            original: originalAmount,
          });
    const originalInput = input.invoices.find(
      (i) => i.localId === originalLocalId && !i.creditNoteForLocalId,
    );
    await run.one(
      "invoice",
      inv.localId,
      async () => {
        const originalId = run.ref("invoice", originalLocalId) as string;
        const original = await ctx.db.query.invoices.findFirst({
          where: and(
            eq(invoices.id, originalId),
            eq(invoices.organizationId, orgId),
          ),
          columns: { amount: true },
        });
        if (!original)
          throw new Error(
            st("ext.import.invoiceNotFound", { id: originalLocalId }),
          );
        const partial = fullCredit(original.amount);
        if (partial) throw new Error(partial);
        // Et afbrudt forsøg kan have krediteret, før koblingen blev gemt.
        const earlier = await ctx.db.query.invoices.findFirst({
          where: and(
            eq(invoices.relatedInvoiceId, originalId),
            eq(invoices.kind, "credit_note"),
            eq(invoices.organizationId, orgId),
          ),
          columns: { id: true },
        });
        if (earlier) return earlier.id;
        const created = await ctx.web.invoices.createCreditNote({
          invoiceId: originalId,
          releaseTimeEntries: false,
        });
        return created.id;
      },
      (amount > 0 ? st("ext.import.creditNoteAmount") : null) ??
        missingRef(run, "invoice", originalLocalId) ??
        (originalInput ? fullCredit(originalInput.data.amount) : null) ??
        // Web krediterer ikke kladder (createCreditNote); dry-run siger det.
        (originalInput && (originalInput.data.status ?? "draft") === "draft"
          ? st("ext.import.invoiceIsDraft", { id: originalLocalId })
          : null),
    );
  }

  // 6. Arkiverede klippekort arkiveres til sidst, efter kaldets poster
  // (web trækker ikke på et arkiveret kort). Springer over, hvis det er sket.
  if (!run.dryRun) {
    for (const k of input.prepaidPackages) {
      if (!k.isArchived) continue;
      const id = run.ref("prepaid", k.localId);
      if (!id) continue;
      try {
        const row = await ctx.db.query.prepaidPackages.findFirst({
          where: and(
            eq(prepaidPackages.id, id),
            eq(prepaidPackages.organizationId, orgId),
          ),
          columns: { isArchived: true },
        });
        if (row && !row.isArchived) await ctx.web.prepaid.archive({ id });
      } catch (err) {
        run.fail("prepaid", k.localId, errorMessage(err));
      }
    }
  }

  const ids = (entity: Entity, list: Array<{ localId: string }>) =>
    Object.fromEntries(
      list
        .map((item) => [item.localId, run.ids[entity].get(item.localId)])
        .filter(([, v]) => v && !v.startsWith("dry-run:")),
    ) as Record<string, string>;

  return {
    dryRun: run.dryRun,
    organizationId: orgId,
    plan: tier,
    report: {
      clients: run.report.client,
      projects: run.report.project,
      prepaidPackages: run.report.prepaid,
      tasks: run.report.task,
      entries: run.report.entry,
      rules: run.report.rule,
      invoices: run.report.invoice,
    },
    errorCount: run.errorCount,
    /** De første 200 fejl. */
    errors: run.errors,
    /** Lokalt id → server-id for elementerne i dette kald (ikke ved dry-run). */
    ids: {
      clients: ids("client", input.clients),
      projects: ids("project", input.projects),
      prepaidPackages: ids("prepaid", input.prepaidPackages),
      tasks: ids("task", input.tasks),
      entries: ids("entry", input.entries),
      rules: ids("rule", input.rules),
      invoices: ids("invoice", input.invoices),
    },
  };
}

/**
 * Kun én rigtig import ad gangen pr. bruger og org. To samtidige kald ville
 * begge se et element som nyt og oprette det to gange. Låsen holdes af en
 * transaktion, der kun bærer låsen; selve importen kører gennem web's egne
 * procedurer som før. Dry-run opretter intet og låser ikke.
 */
async function withImportLock<T>(
  ctx: { db: typeof import("@/lib/db").db; device: DeviceAuth },
  fn: () => Promise<T>,
): Promise<T> {
  const key = `device-import:${ctx.device.orgId ?? ""}:${ctx.device.userId}`;
  return ctx.db.transaction(async (tx) => {
    const [row] = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`,
    )) as unknown as Array<{ locked: boolean }>;
    if (!row?.locked) {
      throw new TRPCError({
        code: "CONFLICT",
        message: await tr("serverErrors", "ext.import.alreadyRunning"),
      });
    }
    return fn();
  });
}

export const extImportRouter = router({
  /** Importér (eller dry-run) en lokal database. Standard er dry-run. */
  run: deviceProcedure
    .input(importInput)
    .mutation(({ ctx, input }) =>
      input.dryRun
        ? runImport(ctx, input)
        : withImportLock(ctx, () => runImport(ctx, input)),
    ),
});
