/**
 * Performance seed: a realistic, larger data set for measuring the dashboard
 * (docs/research/2026-11-22-stabilitet.md). Builds one organisation with an
 * owner and three members, 50 clients, 100 projects, 2,000 time entries over
 * the last year, 300 invoices with lines, 20 klippekort and 300 tasks.
 *
 * Local databases only: it refuses to run unless DATABASE_URL points at
 * localhost/127.0.0.1. Run `npm run db:seed` first (it creates the users);
 * this script then reuses freelancer@test.dk as the owner.
 *
 *   npx tsx scripts/perf/seed-perf.ts
 */
import { randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import postgres from "postgres";
import { FREELANCE_BUNDLE } from "../../src/lib/modules/constants";

dotenv.config({ path: ".env.local" });

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("seed-perf: DATABASE_URL must point at a local database");
  process.exit(1);
}

const ORG_ID = "perf-org";
const CLIENTS = 50;
const PROJECTS = 100;
const ENTRIES = 2000;
const INVOICES = 300;

async function main() {
  const sql = postgres(url, { max: 1 });
  try {
    const [owner] = await sql<{ id: string }[]>`
      select id from "user" where email = 'freelancer@test.dk'`;
    if (!owner) throw new Error("run `npm run db:seed` first");
    const [existing] =
      await sql`select 1 from organizations where id = ${ORG_ID}`;
    if (existing) {
      console.log("seed-perf: already seeded");
      return;
    }

    await sql.begin(async (tx) => {
      await tx`insert into organizations (id, name, slug) values (${ORG_ID}, 'Perf Studio', 'perf-studio')`;
      const userIds = [owner.id];
      for (let i = 1; i <= 3; i++) {
        const id = `perf-member-${i}`;
        await tx`insert into "user" (id, email, "emailVerified", name, onboarding_completed, "createdAt", "updatedAt")
          values (${id}, ${`perf-member-${i}@example.invalid`}, true, ${`Medlem ${i}`}, true, now(), now())`;
        userIds.push(id);
      }
      for (const [i, userId] of userIds.entries()) {
        await tx`insert into members (id, organization_id, user_id, role, cost_rate)
          values (${randomUUID()}, ${ORG_ID}, ${userId}, ${i === 0 ? "owner" : "member"}, 350)`;
      }
      for (const key of FREELANCE_BUNDLE) {
        await tx`insert into organization_modules (id, organization_id, module_key, is_available, is_enabled)
          values (${randomUUID()}, ${ORG_ID}, ${key}, true, true)`;
      }

      // Legacy seed rows belong to the owner without an org: move them in.
      for (const table of [
        "clients",
        "projects",
        "time_entries",
        "tasks",
        "invoices",
      ]) {
        await tx`update ${tx(table)} set organization_id = ${ORG_ID} where user_id = ${owner.id} and organization_id is null`;
      }

      await tx`
        insert into clients (id, name, email, company, user_id, organization_id, default_hourly_rate, city, country, created_at, updated_at)
        select gen_random_uuid(), 'Kunde ' || g, 'kunde' || g || '@example.invalid', 'Firma ' || g || ' ApS',
               ${owner.id}, ${ORG_ID}, 600 + (g % 5) * 100, 'By ' || (g % 10), 'Danmark',
               now() - (g || ' days')::interval, now()
        from generate_series(1, ${CLIENTS}) g`;
      await tx`
        insert into projects (id, name, description, client_id, user_id, organization_id, hourly_rate, status, start_date, created_at, updated_at)
        select gen_random_uuid(), 'Projekt ' || g, 'Beskrivelse ' || g, c.id, ${owner.id}, ${ORG_ID},
               case when g % 3 = 0 then 900 else null end,
               case when g % 7 = 0 then 'completed' else 'active' end,
               now() - interval '300 days', now() - (g || ' days')::interval, now()
        from generate_series(1, ${PROJECTS}) g
        join lateral (select id from clients where organization_id = ${ORG_ID}
                      order by created_at offset (g % ${CLIENTS}) limit 1) c on true`;
      await tx`
        with p as (
          select id, client_id, row_number() over (order by created_at) - 1 as n
          from projects where organization_id = ${ORG_ID}
        ), pc as (select count(*) as total from p)
        insert into time_entries (id, project_id, client_id, user_id, organization_id, description, hours, date,
                                  start_time, end_time, billable_rate, is_billable, is_billed, source, created_at, updated_at)
        select gen_random_uuid(), p.id, p.client_id,
               (${sql.array(userIds)}::text[])[1 + (case when g % 4 = 0 then 1 + g % 3 else 0 end)],
               ${ORG_ID}, 'Opgave ' || g, round((0.25 + (g % 16) * 0.25)::numeric, 2),
               date_trunc('day', now()) - ((g % 365) || ' days')::interval,
               date_trunc('day', now()) - ((g % 365) || ' days')::interval + interval '9 hours',
               date_trunc('day', now()) - ((g % 365) || ' days')::interval + interval '9 hours'
                 + ((0.25 + (g % 16) * 0.25) || ' hours')::interval,
               750, g % 10 <> 0, g % 365 > 60, 'timer',
               now() - ((g % 365) || ' days')::interval, now()
        from generate_series(1, ${ENTRIES}) g
        join p on p.n = g % (select total from pc)`;
      await tx`
        with c as (
          select id, row_number() over (order by created_at) - 1 as n
          from clients where organization_id = ${ORG_ID}
        ), cc as (select count(*) as total from c)
        insert into invoices (id, invoice_number, client_id, user_id, organization_id, amount, status, issue_date, due_date, created_at, updated_at)
        select gen_random_uuid(), 'P-' || lpad(g::text, 5, '0'), c.id, ${owner.id}, ${ORG_ID}, 7500,
               (array['draft','sent','paid','paid','overdue'])[1 + g % 5],
               now() - ((g % 365) || ' days')::interval, now() - ((g % 365) || ' days')::interval + interval '14 days',
               now() - ((g % 365) || ' days')::interval, now()
        from generate_series(1, ${INVOICES}) g
        join c on c.n = g % (select total from cc)`;
      await tx`
        insert into invoice_lines (id, invoice_id, description, quantity, unit_price, amount, sort_order, created_at)
        select gen_random_uuid(), i.id, 'Linje ' || l, 5, 750, 3750, l, now()
        from invoices i cross join generate_series(1, 2) l
        where i.organization_id = ${ORG_ID} and i.invoice_number like 'P-%'`;
      await tx`
        insert into prepaid_packages (id, name, client_id, user_id, organization_id, total_hours, remaining_hours,
                                      hourly_rate, total_value, purchase_date, created_at, updated_at)
        select gen_random_uuid(), 'Klippekort ' || n, id, ${owner.id}, ${ORG_ID}, 20, 20 - (n % 15), 700, 14000,
               now() - interval '60 days', now(), now()
        from (select id, row_number() over (order by created_at) as n
              from clients where organization_id = ${ORG_ID}) c
        where n <= 20`;
      await tx`
        insert into tasks (id, user_id, organization_id, title, project_id, client_id, status, priority, position, created_at, updated_at)
        select gen_random_uuid(), ${owner.id}, ${ORG_ID}, 'Opgave ' || g, p.id, p.client_id,
               (array['backlog','todo','in_progress','done'])[1 + g % 4], 'medium', g, now(), now()
        from generate_series(1, 300) g
        join lateral (select id, client_id from projects where organization_id = ${ORG_ID}
                      order by created_at offset (g % ${PROJECTS}) limit 1) p on true`;
    });

    const counts = await sql`
      select (select count(*) from clients where organization_id = ${ORG_ID}) as clients,
             (select count(*) from projects where organization_id = ${ORG_ID}) as projects,
             (select count(*) from time_entries where organization_id = ${ORG_ID}) as entries,
             (select count(*) from invoices where organization_id = ${ORG_ID}) as invoices`;
    console.log("seed-perf:", counts[0]);
    await sql`analyze`;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
