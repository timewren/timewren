/**
 * Measures the tRPC procedures behind the main dashboard pages against a
 * local database seeded with scripts/perf/seed-perf.ts: server time per call
 * (median of RUNS, warm) and the number of SQL statements per call, counted
 * with pg_stat_statements. Results feed docs/research/2026-11-22-stabilitet.md.
 *
 * Runs the procedures through appRouter.createCaller with the same context
 * /api/trpc builds (session, db, per-request memo), so middleware (auth, org,
 * modules) is included; the HTTP layer and better-auth's session lookup are
 * not. Needs the pg_stat_statements extension in the local database.
 *
 * Runs under Vitest (its resolver copes with the app's ESM-only packages,
 * which plain tsx does not):
 *
 *   npx vitest run --config scripts/perf/vitest.perf.config.ts
 *   PERF_JSON=out.json PERF_ONLY=time.list npx vitest run --config …
 *   PERF_KEEP_STATS=1 …   (then read pg_stat_statements for the whole run)
 */
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import superjson from "superjson";
import { it } from "vitest";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  throw new Error("measure-trpc: DATABASE_URL must point at a local database");
}

const RUNS = 7;
const ORG_ID = "perf-org";

type Case = {
  page: string;
  name: string;
  call: (caller: Caller, ids: Ids) => Promise<unknown>;
};
type Ids = { clientId: string; projectId: string; userId: string };
// biome-ignore lint/suspicious/noExplicitAny: measurement script over the whole router
type Caller = any;

function iso(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const [{ appRouter }, { db }, { createRequestMemo }, { SYSTEM_TEMPLATES }] =
    await Promise.all([
      import("../../src/lib/trpc/routers"),
      import("../../src/lib/db"),
      import("../../src/lib/trpc/request-memo"),
      import("../../src/lib/reports/defaults"),
    ]);
  const stats = postgres(url, { max: 1 });

  const [user] = await stats<{ id: string; email: string; name: string }[]>`
    select id, email, name from "user" where email = 'freelancer@test.dk'`;
  const [client] = await stats<{ id: string }[]>`
    select c.id from clients c join time_entries t on t.client_id = c.id
    where c.organization_id = ${ORG_ID}
    group by c.id order by count(*) desc limit 1`;
  const [project] = await stats<{ id: string }[]>`
    select p.id from projects p join time_entries t on t.project_id = p.id
    where p.organization_id = ${ORG_ID}
    group by p.id order by count(*) desc limit 1`;
  const ids: Ids = {
    clientId: client.id,
    projectId: project.id,
    userId: user.id,
  };

  const session = {
    user: { ...user, emailVerified: true, role: "user" },
    session: {
      id: "perf-session",
      userId: user.id,
      activeOrganizationId: ORG_ID,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  };
  const newCaller = (): Caller =>
    appRouter.createCaller({
      session,
      db,
      headers: null,
      memo: createRequestMemo(),
    } as never);

  const reportConfig = structuredClone(SYSTEM_TEMPLATES[0].config);

  const cases: Case[] = [
    // App shell: runs on every dashboard page
    {
      page: "shell",
      name: "user.getProfile",
      call: (c) => c.user.getProfile(),
    },
    {
      page: "shell",
      name: "time.getRecent",
      call: (c) => c.time.getRecent({ limit: 10 }),
    },
    {
      page: "shell",
      name: "rolePermissions.getMyPermissions",
      call: (c) => c.rolePermissions.getMyPermissions(),
    },
    // Tidsregistrering
    {
      page: "time",
      name: "time.list (30 dage)",
      call: (c) => c.time.list({ startDate: iso(30), endDate: iso(0) }),
    },
    {
      page: "time",
      name: "time.list (uge, limit 500)",
      call: (c, i) =>
        c.time.list({
          startDate: iso(7),
          endDate: iso(0),
          memberId: i.userId,
          limit: 500,
        }),
    },
    {
      page: "time",
      name: "time.list (limit 100)",
      call: (c) => c.time.list({ limit: 100 }),
    },
    {
      page: "time",
      name: "time.list (30 dage, summary)",
      call: (c) =>
        c.time.list({ startDate: iso(30), endDate: iso(0), view: "summary" }),
    },
    {
      page: "time",
      name: "time.list (uge, limit 500, summary)",
      call: (c, i) =>
        c.time.list({
          startDate: iso(7),
          endDate: iso(0),
          memberId: i.userId,
          limit: 500,
          view: "summary",
        }),
    },
    { page: "time", name: "projects.list", call: (c) => c.projects.list() },
    { page: "time", name: "clients.list", call: (c) => c.clients.list() },
    {
      page: "time",
      name: "tasks.listForTime",
      call: (c) => c.tasks.listForTime(),
    },
    {
      page: "time",
      name: "organization.getMembers",
      call: (c) => c.organization.getMembers(),
    },
    // Kunder
    {
      page: "clients",
      name: "clients.listWithStats",
      call: (c) => c.clients.listWithStats({ includeArchived: true }),
    },
    {
      page: "clients",
      name: "clients.getById",
      call: (c, i) => c.clients.getById({ id: i.clientId }),
    },
    {
      page: "clients",
      name: "time.list (kunde, 1000 + totals)",
      call: (c, i) =>
        c.time.list({
          forClientId: i.clientId,
          limit: 1000,
          includeClientTotals: true,
        }),
    },
    {
      page: "clients",
      name: "time.list (kunde, 1000 + totals, summary)",
      call: (c, i) =>
        c.time.list({
          forClientId: i.clientId,
          limit: 1000,
          includeClientTotals: true,
          view: "summary",
        }),
    },
    {
      page: "clients",
      name: "prepaid.list (kunde)",
      call: (c, i) => c.prepaid.list({ clientId: i.clientId }),
    },
    {
      page: "clients",
      name: "invoices.list (kunde)",
      call: (c, i) => c.invoices.list({ clientId: i.clientId, limit: 200 }),
    },
    {
      page: "clients",
      name: "projects.getByClient",
      call: (c, i) => c.projects.getByClient({ clientId: i.clientId }),
    },
    // Projekter
    {
      page: "projects",
      name: "projects.listWithStats",
      call: (c) => c.projects.listWithStats({ period: "all" }),
    },
    {
      page: "projects",
      name: "projects.getById",
      call: (c, i) => c.projects.getById({ id: i.projectId }),
    },
    {
      page: "projects",
      name: "projects.getStats",
      call: (c, i) => c.projects.getStats({ projectId: i.projectId }),
    },
    {
      page: "projects",
      name: "time.list (projekt)",
      call: (c, i) => c.time.list({ projectId: i.projectId }),
    },
    {
      page: "projects",
      name: "time.list (projekt, summary)",
      call: (c, i) => c.time.list({ projectId: i.projectId, view: "summary" }),
    },
    // Fakturaer
    { page: "invoices", name: "invoices.list", call: (c) => c.invoices.list() },
    {
      page: "invoices",
      name: "invoices.getStats",
      call: (c) => c.invoices.getStats(),
    },
    {
      page: "invoices",
      name: "invoices.numberSeriesAudit",
      call: (c) => c.invoices.numberSeriesAudit(),
    },
    {
      page: "invoices",
      name: "invoices.getUninvoicedTimeEntries",
      call: (c, i) =>
        c.invoices.getUninvoicedTimeEntries({ clientId: i.clientId }),
    },
    // Rapporter
    {
      page: "reports",
      name: "reports.getReportData",
      call: (c) => c.reports.getReportData({ config: reportConfig }),
    },
    {
      page: "reports",
      name: "reports.getRealRates",
      call: (c) => c.reports.getRealRates({ months: 6 }),
    },
    {
      page: "reports",
      name: "reports.getTeamUtilization",
      call: (c) => c.reports.getTeamUtilization({ months: 3 }),
    },
    {
      page: "reports",
      name: "reports.getTeamProfitability",
      call: (c) => c.reports.getTeamProfitability({ months: 3 }),
    },
    {
      page: "reports",
      name: "reportTemplates.list",
      call: (c) => c.reportTemplates.list(),
    },
  ];

  const only = process.env.PERF_ONLY ?? null;
  const results: {
    page: string;
    name: string;
    medianMs?: number;
    queries?: number;
    dbMs?: number;
    rows?: number;
    /** Response size as superjson-serialised, like /api/trpc sends it */
    kb?: number;
    error?: string;
  }[] = [];

  for (const testCase of cases) {
    if (only && !testCase.name.includes(only)) continue;
    try {
      // Warm-up: module load, JIT, prepared statements
      await testCase.call(newCaller(), ids);
      // PERF_KEEP_STATS=1 keeps pg_stat_statements across cases, so the
      // slowest statements of the whole run can be read afterwards (the
      // per-call SQL counts are then cumulative and not meaningful).
      if (!process.env.PERF_KEEP_STATS) {
        await stats`select pg_stat_statements_reset()`;
      }
      const out = await testCase.call(newCaller(), ids);
      const [q] = await stats<{ calls: string; ms: string }[]>`
        select coalesce(sum(calls), 0) as calls, coalesce(sum(total_exec_time), 0) as ms
        from pg_stat_statements
        where query not ilike '%pg_stat_statements%'`;
      const times: number[] = [];
      for (let r = 0; r < RUNS; r++) {
        const t0 = performance.now();
        await testCase.call(newCaller(), ids);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const rows = Array.isArray(out)
        ? out.length
        : out && typeof out === "object"
          ? (Object.values(out).find(Array.isArray)?.length ?? undefined)
          : undefined;
      results.push({
        page: testCase.page,
        name: testCase.name,
        medianMs: Math.round(times[Math.floor(RUNS / 2)] * 10) / 10,
        queries: Number(q.calls),
        dbMs: Math.round(Number(q.ms) * 10) / 10,
        rows,
        kb:
          Math.round(JSON.stringify(superjson.serialize(out)).length / 102.4) /
          10,
      });
    } catch (err) {
      results.push({
        page: testCase.page,
        name: testCase.name,
        error: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
    }
  }

  console.log("\n| Side | Kald | Median ms | SQL-kald | DB ms | Rækker | KB |");
  console.log("|---|---|---:|---:|---:|---:|---:|");
  for (const r of results) {
    if (r.error) {
      console.log(`| ${r.page} | ${r.name} | fejl: ${r.error} | | | | |`);
      continue;
    }
    console.log(
      `| ${r.page} | ${r.name} | ${r.medianMs} | ${r.queries} | ${r.dbMs} | ${r.rows ?? ""} | ${r.kb} |`,
    );
  }
  if (process.env.PERF_JSON) {
    writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 2));
  }
  await stats.end();
}

it("measures the dashboard tRPC procedures", main, 10 * 60_000);
