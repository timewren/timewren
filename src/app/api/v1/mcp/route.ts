// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { moreResultsHint, pageOffset } from "@/lib/api/list-query";
import { verifyMcpToken } from "@/lib/api/mcp-auth";
import { guardToolScopes } from "@/lib/api/mcp-scopes";
import {
  parsePrepaidMode,
  resolveAutoPrepaidPackageId,
} from "@/lib/api/prepaid-auto";
import { patchTimeEntry } from "@/lib/api/time-entry-patch";
import type { Session } from "@/lib/auth";
import {
  MCP_RESOURCE_METADATA_PATH,
  mcpResourceUrl,
} from "@/lib/auth/mcp-oauth";
import { db } from "@/lib/db";
import { appRouter } from "@/lib/trpc/routers/index";
import {
  getClientIp,
  ipRateLimitKey,
  rateLimiter,
} from "@/lib/utils/rate-limiter";

// Build a per-request, org-scoped tRPC caller from the AuthInfo the
// verifyToken step resolved. Tools reuse the exact same logic as the REST API.
function callerFrom(ctx: {
  http?: {
    authInfo?: { extra?: { userId?: unknown; organizationId?: unknown } };
  };
}) {
  const a = ctx.http?.authInfo?.extra ?? {};
  const userId = String(a.userId ?? "");
  const organizationId =
    typeof a.organizationId === "string" ? a.organizationId : undefined;
  return appRouter.createCaller({
    session: {
      user: { id: userId },
      activeOrganizationId: organizationId,
    } as Session & { activeOrganizationId: string | undefined },
    db,
    headers: new Headers(),
  });
}

// Wrap any JSON-serialisable result as MCP text content. A list that is only
// part of the result gets a second text block saying so (#573) — the data
// block keeps its shape, so existing consumers are unaffected.
function ok(data: unknown, hint?: string | null) {
  const content = [
    { type: "text" as const, text: JSON.stringify(data, null, 2) },
  ];
  if (hint) content.push({ type: "text" as const, text: hint });
  return { content };
}

// Shared paging inputs for the list tools. Defaults match what each tool
// returned before, so a call without them behaves as it did.
function pagingInput(defaultLimit: number, maxLimit: number) {
  return {
    page: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Page number, 1-indexed (default 1)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .optional()
      .describe(`Results per page (default ${defaultLimit}, max ${maxLimit})`),
  };
}

// Walk time.list's cursor until every entry for the client is loaded. Bounded
// so a runaway loop can never hold the request open indefinitely.
const MAX_ENTRY_PAGES = 50;
async function listAllTimeEntries(
  caller: ReturnType<typeof callerFrom>,
  clientId: string,
) {
  // Keyed by id: an entry must never land on an invoice twice, even if a
  // page boundary were to repeat a row.
  const entries = new Map<
    string,
    Awaited<ReturnType<typeof caller.time.list>>["entries"][number]
  >();
  let cursor: string | undefined;
  for (let i = 0; i < MAX_ENTRY_PAGES; i++) {
    const result = await caller.time.list({ clientId, limit: 1000, cursor });
    for (const entry of result.entries) entries.set(entry.id, entry);
    if (!result.hasMore || !result.nextCursor) return [...entries.values()];
    cursor = result.nextCursor;
  }
  throw new Error(
    `More than ${MAX_ENTRY_PAGES * 1000} time entries for this client - pass timeEntryIds explicitly.`,
  );
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const baseHandler = createMcpHandler(
  (server) => {
    // Håndhæv API-nøglens scopes pr. værktøj, som REST-ruternes requireScope.
    guardToolScopes(server);

    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description:
          "Return the authenticated user id, organization, and scopes for the API key.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (_args, extra) => {
        const a = extra.http?.authInfo;
        return ok({
          userId: a?.extra?.userId,
          organizationId: a?.extra?.organizationId,
          scopes: a?.scopes ?? [],
        });
      },
    );

    server.registerTool(
      "list_clients",
      {
        title: "List clients",
        description:
          "List clients with their default hourly rate and contact info, sorted by name. Paginated: if there are more clients, a note says which page to request next.",
        inputSchema: z.object({
          q: z
            .string()
            .optional()
            .describe("Search name, email, company or CVR"),
          includeArchived: z.boolean().optional(),
          ...pagingInput(500, 500),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ q, includeArchived, page = 1, limit = 500 }, extra) => {
        const result = await callerFrom(extra).clients.listPage({
          q,
          includeArchived,
          limit,
          offset: pageOffset(page, limit),
        });
        return ok(
          result.clients,
          moreResultsHint(
            "clients",
            page,
            limit,
            result.clients.length,
            result.total,
          ),
        );
      },
    );

    server.registerTool(
      "get_client",
      {
        title: "Get client",
        description: "Get a single client by id.",
        inputSchema: z.object({ id: z.string().describe("Client id (UUID)") }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ id }, extra) =>
        ok(await callerFrom(extra).clients.getById({ id })),
    );

    server.registerTool(
      "create_client",
      {
        title: "Create client",
        description:
          'Create a new client. Provide defaultHourlyRate as a decimal string (e.g. "850").',
        inputSchema: z.object({
          name: z.string().describe("Client name"),
          email: z.string().optional(),
          cvrNumber: z.string().optional(),
          defaultHourlyRate: z
            .string()
            .optional()
            .describe("Decimal as string"),
          notes: z.string().optional(),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async (args, extra) => ok(await callerFrom(extra).clients.create(args)),
    );

    server.registerTool(
      "list_time_entries",
      {
        title: "List time entries",
        description:
          "List time entries, newest first. Filter by client, project, date range, billable and billed status. Paginated: if there are more entries, a note says which page to request next.",
        inputSchema: z.object({
          clientId: z.string().optional(),
          projectId: z.string().optional(),
          startDate: z.string().optional().describe("YYYY-MM-DD"),
          endDate: z.string().optional().describe("YYYY-MM-DD"),
          isBillable: z.boolean().optional(),
          isBilled: z.boolean().optional(),
          ...pagingInput(100, 1000),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ page = 1, limit = 100, ...filters }, extra) => {
        const result = await callerFrom(extra).time.list({
          ...filters,
          limit,
          offset: pageOffset(page, limit),
          includeTotal: true,
        });
        return ok(
          result,
          moreResultsHint(
            "time entries",
            page,
            limit,
            result.entries.length,
            result.total ?? 0,
          ),
        );
      },
    );

    server.registerTool(
      "create_time_entry",
      {
        title: "Create time entry",
        description:
          'Log a time entry for a client or project. Set startTime/endTime (ISO) so it shows in the calendar. billableRate overrides the rate hierarchy. To draw the hours from a prepaid package (klippekort), send prepaid: "auto" (the client\'s active auto-deduct package that expires first, same rule as the web app; no package = no deduction) or an explicit prepaidPackageId.',
        inputSchema: z.object({
          clientId: z.string().optional(),
          projectId: z.string().optional(),
          description: z.string(),
          hours: z.number().describe("Decimal hours, e.g. 1.5"),
          date: z.string().describe("YYYY-MM-DD"),
          startTime: z.string().optional().describe("ISO datetime"),
          endTime: z.string().optional().describe("ISO datetime"),
          isBillable: z.boolean().optional(),
          billableRate: z.string().optional().describe("Decimal as string"),
          prepaid: z
            .literal("auto")
            .optional()
            .describe(
              '"auto" draws from the client\'s klippekort that expires first',
            ),
          prepaidPackageId: z
            .string()
            .optional()
            .describe(
              "Explicit klippekort id (UUID); cannot be combined with prepaid",
            ),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async ({ prepaid, prepaidPackageId, ...args }, extra) => {
        const mode = parsePrepaidMode({ prepaid, prepaidPackageId });
        if (!mode.ok) return fail(mode.message);
        const caller = callerFrom(extra);
        // prepaid: "auto" (#422) — samme udløber-først-regel som web/extension
        const packageId = mode.auto
          ? await resolveAutoPrepaidPackageId(caller, args)
          : prepaidPackageId;
        return ok(
          await caller.time.create({
            ...args,
            prepaidPackageId: packageId ?? undefined,
          }),
        );
      },
    );

    server.registerTool(
      "update_time_entry",
      {
        title: "Update time entry",
        description:
          "Update fields on a time entry. Only provided fields change; omitted fields keep their current value. Send clientId or projectId as null to remove it. Billed entries are locked. prepaid: \"auto\" draws the entry from the client's klippekort that expires first (kept if already drawn from one of the client's packages); prepaidPackageId moves the deduction, null removes it.",
        inputSchema: z.object({
          id: z.string().describe("Time entry id (UUID)"),
          description: z.string().optional(),
          hours: z.number().positive().optional(),
          date: z.string().min(1).optional().describe("YYYY-MM-DD"),
          clientId: z
            .string()
            .nullable()
            .optional()
            .describe("null removes the client"),
          projectId: z
            .string()
            .nullable()
            .optional()
            .describe("null removes the project"),
          isBillable: z.boolean().optional(),
          billableRate: z.string().optional(),
          startTime: z.string().optional(),
          endTime: z.string().optional(),
          prepaid: z
            .literal("auto")
            .optional()
            .describe(
              '"auto" draws from the client\'s klippekort that expires first',
            ),
          prepaidPackageId: z
            .string()
            .nullable()
            .optional()
            .describe(
              "Klippekort id (UUID) to draw from; null removes the deduction",
            ),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
        },
      },
      async ({ id, ...args }, extra) => {
        // PATCH-semantik (#718): kun sendte felter ændres, eksplicit null rydder.
        const patch = Object.fromEntries(
          Object.entries(args).filter(([, v]) => v !== undefined),
        );
        const result = await patchTimeEntry(callerFrom(extra), id, patch);
        return result.ok ? ok(result.entry) : fail(result.message);
      },
    );

    server.registerTool(
      "list_prepaid_packages",
      {
        title: "List prepaid packages (klippekort)",
        description:
          "List prepaid hour packages (klippekort) with their balance: total, used and remaining hours, expiry and status. Filter by client.",
        inputSchema: z.object({
          clientId: z.string().optional(),
          activeOnly: z.boolean().optional().describe("Only active packages"),
          includeArchived: z.boolean().optional(),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ clientId, activeOnly, includeArchived }, extra) => {
        const packages = await callerFrom(extra).prepaid.list({
          clientId,
          activeOnly,
          includeArchived,
        });
        return ok(
          packages.map((p) => ({
            id: p.id,
            name: p.name,
            clientId: p.clientId,
            clientName: p.client?.name ?? null,
            totalHours: p.totalHours,
            usedHours: p.usedHours,
            remainingHours: p.remainingHours,
            purchaseDate: p.purchaseDate,
            expiryDate: p.expiryDate,
            isActive: p.isActive,
          })),
        );
      },
    );

    server.registerTool(
      "unbilled_summary",
      {
        title: "Unbilled summary",
        description:
          "Unbilled (billable, not yet invoiced) hours and amount grouped by client, with totals.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (_args, extra) => {
        // Same aggregate as GET /api/v1/reports/unbilled. Aggregating
        // time.list here stopped silently at its default of 100 entries.
        const groups = await callerFrom(extra).time.unbilledByClient();
        let totalHours = 0;
        let totalAmount = 0;
        for (const g of groups) {
          totalHours += g.hours;
          totalAmount += g.value;
        }
        return ok({
          totalHours: totalHours.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
          byClient: [...groups]
            .sort((a, b) => b.value - a.value)
            .map((g) => ({
              clientId: g.clientId,
              clientName: g.clientName,
              hours: g.hours.toFixed(2),
              amount: g.value.toFixed(2),
              entryCount: g.entryCount,
            })),
        });
      },
    );

    server.registerTool(
      "list_invoices",
      {
        title: "List invoices",
        description:
          "List invoices, newest first, optionally for a single client or status. Paginated: if there are more invoices, a note says which page to request next.",
        inputSchema: z.object({
          clientId: z.string().optional(),
          status: z.string().optional().describe("e.g. draft, sent, paid"),
          ...pagingInput(500, 500),
        }),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ clientId, status, page = 1, limit = 500 }, extra) => {
        const result = await callerFrom(extra).invoices.listPage({
          clientId,
          status,
          limit,
          offset: pageOffset(page, limit),
        });
        return ok(
          result.invoices,
          moreResultsHint(
            "invoices",
            page,
            limit,
            result.invoices.length,
            result.total,
          ),
        );
      },
    );

    server.registerTool(
      "invoice_from_time_entries",
      {
        title: "Invoice from time entries",
        description:
          "Generate a draft invoice from a client's time entries. With dryRun=true, returns the line items + total WITHOUT creating anything (preview). Omit timeEntryIds to use all unbilled billable entries for the client. Creating (dryRun=false) marks the entries billed. Confirm with the user first.",
        inputSchema: z.object({
          clientId: z.string(),
          timeEntryIds: z.array(z.string()).optional(),
          notes: z.string().optional(),
          dueDate: z.string().optional().describe("YYYY-MM-DD"),
          dryRun: z.boolean().optional().describe("Preview without creating"),
        }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
        },
      },
      async ({ clientId, timeEntryIds, notes, dueDate, dryRun }, extra) => {
        const caller = callerFrom(extra);
        // Every entry for the client, not just time.list's first page of 100 -
        // otherwise older unbilled entries were silently left off the invoice.
        const all = (await listAllTimeEntries(caller, clientId)) as Array<{
          id: string;
          description: string | null;
          hours: string | null;
          roundedHours?: string | null;
          billableRate: string | null;
          date: string | Date;
          isBillable: boolean;
          isBilled: boolean;
        }>;
        const selected = timeEntryIds?.length
          ? all.filter((e) => timeEntryIds.includes(e.id))
          : all.filter((e) => e.isBillable && !e.isBilled);
        if (selected.length === 0)
          return fail(
            "No unbilled billable time entries for this client. Use unbilled_summary to see which clients have billable time.",
          );
        if (dryRun) {
          let total = 0;
          const lineItems = selected.map((e) => {
            const hours = Number(e.roundedHours ?? e.hours ?? 0) || 0;
            const rate = e.billableRate ? Number(e.billableRate) : 0;
            total += hours * rate;
            return {
              date: (typeof e.date === "string"
                ? e.date
                : new Date(e.date).toISOString()
              ).slice(0, 10),
              description: e.description || "Tidsregistrering",
              hours: hours.toFixed(2),
              rate: rate.toFixed(2),
              amount: (hours * rate).toFixed(2),
            };
          });
          return ok({
            dryRun: true,
            clientId,
            entryCount: lineItems.length,
            totalAmount: total.toFixed(2),
            lineItems,
          });
        }
        return ok(
          await caller.invoices.generateFromTimeEntries({
            clientId,
            timeEntryIds: selected.map((e) => e.id),
            notes,
            dueDate,
          }),
        );
      },
    );

    server.registerTool(
      "send_invoice",
      {
        title: "Send invoice",
        description:
          "Email an invoice to the client. This is outward-facing and hard to undo. Confirm with the user first.",
        inputSchema: z.object({ id: z.string().describe("Invoice id (UUID)") }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        },
      },
      async ({ id }, extra) =>
        ok(await callerFrom(extra).invoices.sendEmail({ id })),
    );
  },
  { serverInfo: { name: "timetrack", version: "1.0.0" } },
);

// Efter godkendt token: plan-afvisning (403, re-autorisation hjælper ikke) og
// rate limit pr. nøgle/AI-app og bruger, før selve MCP-protokollen.
async function gatedHandler(req: Request): Promise<Response> {
  const info = (req as Request & { auth?: AuthInfo }).auth;
  const extra = (info?.extra ?? {}) as {
    userId?: unknown;
    planDenied?: unknown;
  };
  if (typeof extra.planDenied === "string") {
    return Response.json(
      { error: "forbidden", error_description: extra.planDenied },
      { status: 403 },
    );
  }
  const limit = await rateLimiter.check(
    `mcp:${info?.clientId ?? ""}:${String(extra.userId ?? "")}`,
    "mcp",
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "rate_limited", error_description: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.resetIn / 1000)) },
      },
    );
  }
  return baseHandler(req);
}

// 401 bærer `WWW-Authenticate: Bearer resource_metadata=…` (RFC 9728), så
// Claude/ChatGPT kan finde autorisationsserveren og starte OAuth-flowet.
const authedHandler = withMcpAuth(gatedHandler, verifyMcpToken, {
  required: true,
  resourceMetadataPath: MCP_RESOURCE_METADATA_PATH,
  resourceUrl: new URL(mcpResourceUrl()).origin,
});

// Brute-force-loft pr. IP, som REST-nøgleopslaget: alle kald tæller, et
// gyldigt token nulstiller budgettet, så kun fejlede forsøg ophobes.
async function handler(req: Request): Promise<Response> {
  const ipKey = ipRateLimitKey(getClientIp(req.headers), "mcp-auth");
  const ipLimit = await rateLimiter.check(ipKey, "apiAuth");
  if (!ipLimit.allowed) {
    return Response.json(
      { error: "rate_limited", error_description: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(ipLimit.resetIn / 1000)) },
      },
    );
  }
  const res = await authedHandler(req);
  if (res.status !== 401) await rateLimiter.reset(ipKey);
  return res;
}

export { handler as GET, handler as POST };
