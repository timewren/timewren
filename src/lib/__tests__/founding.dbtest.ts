/**
 * Founding-mærket mod rigtig Postgres: udvælgelse, idempotens, kreditkandidater
 * og at mærket kun vises for Founding-orgs. Kører KUN med TT_DB_TESTS=1 og en
 * DATABASE_URL til en kasseret database med repoets schema
 * (se docs/testing/timer-model-tests.md).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { foundingTicketIds, isOrgFounding } from "@/lib/founding";
import {
  listCreditCandidates,
  markFounding,
  selectFoundingOrgs,
} from "../../../scripts/founding/lib";

const ENABLED = process.env.TT_DB_TESTS === "1";
const NOW = new Date("2026-11-08T12:00:00Z");
const BEFORE = new Date("2026-11-09T00:00:00Z");
const OLD = "2026-01-01T00:00:00Z";
const day = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe.skipIf(!ENABLED)("founding", () => {
  let client: postgres.Sql;
  // biome-ignore lint/suspicious/noExplicitAny: test-db uden app-typen
  let db: any;
  const tag = `fnd${Date.now().toString(36)}`;
  const id = (s: string) => `${tag}_${s}`;

  async function org(s: string, createdAt: string, brand = "timetrack") {
    await client`INSERT INTO organizations (id, name, slug, brand, created_at)
      VALUES (${id(s)}, ${`org ${s}`}, ${id(`slug_${s}`)}, ${brand}, ${createdAt})`;
  }
  async function user(s: string, orgS: string) {
    await client`INSERT INTO "user" (id, email, name) VALUES (${id(`u_${s}`)}, ${`${id(s)}@example.invalid`}, ${`u ${s}`})`;
    await client`INSERT INTO members (id, organization_id, user_id, role)
      VALUES (${id(`m_${s}`)}, ${id(orgS)}, ${id(`u_${s}`)}, 'owner')`;
  }
  async function sub(s: string, o: Record<string, unknown>) {
    await client`INSERT INTO subscriptions (user_id, organization_id, billing_cycle, status, is_trial, trial_ends_at, alunta_subscription_id, store_provider, current_period_end)
      VALUES (${id(`u_${s}`)}, ${id(s)}, ${(o.cycle as string) ?? "monthly"}, ${(o.status as string) ?? "trialing"}, ${(o.trial as boolean) ?? true}, ${NOW.toISOString()}, ${(o.alunta as string) ?? null}, ${(o.store as string) ?? null}, ${(o.periodEnd as string) ?? null})`;
  }
  async function entry(s: string, date: string) {
    await client`INSERT INTO time_entries (user_id, organization_id, hours, date)
      VALUES (${id(`u_${s}`)}, ${id(s)}, 1, ${date})`;
  }
  const mine = (ids: string[]) => ids.filter((x) => x.startsWith(tag));

  beforeAll(async () => {
    client = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema });
    // betalt abonnement, ingen aktivitet
    await org("paid", OLD);
    await user("paid", "paid");
    await sub("paid", { status: "active", trial: false, alunta: "sub-paid" });
    // tidligere betalt (opsagt), ingen aktivitet
    await org("lapsed", OLD);
    await user("lapsed", "lapsed");
    await sub("lapsed", {
      status: "canceled",
      trial: false,
      alunta: "sub-lapsed",
    });
    // kun prøve + ingen aktivitet: skal ikke med
    await org("trial", OLD);
    await user("trial", "trial");
    await sub("trial", { status: "trialing", trial: true });
    // prøve som Alunta melder 'active': er ikke betalt, skal ikke med
    await org("trialactive", OLD);
    await user("trialactive", "trialactive");
    await sub("trialactive", {
      status: "active",
      trial: true,
      alunta: "sub-ta",
    });
    // aktiv inden for 90 dage
    await org("active", OLD);
    await user("active", "active");
    await entry("active", day(89));
    // sidst aktiv for 91 dage siden: skal ikke med
    await org("stale", OLD);
    await user("stale", "stale");
    await entry("stale", day(91));
    // oprettet efter grænsen, selv om den er aktiv
    await org("new", "2026-11-09T08:00:00Z");
    await user("new", "new");
    await entry("new", day(1));
    // andet brand
    await org("wren", OLD, "timewren");
    await user("wren", "wren");
    await entry("wren", day(1));
    // butiksstyret, aktiv
    await org("store", OLD);
    await user("store", "store");
    await sub("store", { status: "active", trial: false, store: "apple" });
  });

  afterAll(async () => {
    await client`DELETE FROM support_tickets WHERE sender_name = ${tag}`;
    await client`DELETE FROM support_inboxes WHERE email = ${`${tag}@example.invalid`}`;
    await client`DELETE FROM time_entries WHERE organization_id LIKE ${`${tag}%`}`;
    await client`DELETE FROM subscriptions WHERE organization_id LIKE ${`${tag}%`}`;
    await client`DELETE FROM members WHERE organization_id LIKE ${`${tag}%`}`;
    await client`DELETE FROM "user" WHERE id LIKE ${`${tag}%`}`;
    await client`DELETE FROM organizations WHERE id LIKE ${`${tag}%`}`;
    await client.end();
  });

  it("vælger betalte, tidligere betalte og aktive; ikke prøve, inaktive, nye eller andre brands", async () => {
    const sel = await selectFoundingOrgs(db, { before: BEFORE, now: NOW });
    expect(mine(sel.candidates)).toEqual(
      ["active", "lapsed", "paid", "store"].map(id).sort(),
    );
  });

  it("er idempotent: anden kørsel markerer intet nyt og ændrer ikke datoen", async () => {
    const first = await selectFoundingOrgs(db, { before: BEFORE, now: NOW });
    const t1 = new Date("2026-11-08T12:00:00Z");
    const done = await markFounding(db, mine(first.candidates), t1);
    expect(done).toHaveLength(4);

    const again = await selectFoundingOrgs(db, { before: BEFORE, now: NOW });
    expect(mine(again.candidates)).toEqual([]);
    const redo = await markFounding(
      db,
      mine(first.candidates),
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(redo).toEqual([]);
    const rows =
      await client`SELECT founding_since FROM organizations WHERE id = ${id("paid")}`;
    expect(new Date(rows[0].founding_since).toISOString()).toBe(
      t1.toISOString(),
    );
    // de tre fravalgte er stadig umærkede
    const others =
      await client`SELECT id FROM organizations WHERE id LIKE ${`${tag}%`} AND founding_since IS NULL ORDER BY id`;
    expect(others.map((r) => r.id)).toEqual(
      ["new", "stale", "trial", "trialactive", "wren"].map(id).sort(),
    );
  });

  it("mærket vises kun for Founding-orgs", async () => {
    expect(await isOrgFounding(db, id("paid"))).toBe(true);
    expect(await isOrgFounding(db, id("trial"))).toBe(false);
    expect(await isOrgFounding(db, null)).toBe(false);
  });

  it("støtte-markering følger organisationen (direkte og via afsenderens medlemskab)", async () => {
    const mk = async (s: string, orgS: string | null, userS: string | null) => {
      const r =
        await client`INSERT INTO support_tickets (subject, sender_email, sender_name, user_id, organization_id, inbox_id)
        VALUES ('t', 'x@example.invalid', ${tag}, ${userS ? id(`u_${userS}`) : null}, ${orgS ? id(orgS) : null},
          (SELECT id FROM support_inboxes LIMIT 1)) RETURNING id`;
      return r[0].id as string;
    };
    const inbox = await client`SELECT id FROM support_inboxes LIMIT 1`;
    if (inbox.length === 0) {
      await client`INSERT INTO support_inboxes (name, email) VALUES ('t', ${`${tag}@example.invalid`})`;
    }
    const a = await mk("a", "paid", "paid");
    const b = await mk("b", "trial", "trial");
    const c = await mk("c", null, "paid");
    const d = await mk("d", null, "trial");
    const e = await mk("e", null, null);
    const set = await foundingTicketIds(db, [
      { id: a, organizationId: id("paid"), userId: id("u_paid") },
      { id: b, organizationId: id("trial"), userId: id("u_trial") },
      { id: c, organizationId: null, userId: id("u_paid") },
      { id: d, organizationId: null, userId: id("u_trial") },
      { id: e, organizationId: null, userId: null },
    ]);
    expect([...set].sort()).toEqual([a, c].sort());
  });

  it("kreditkandidater: kun mærkede orgs med aktivt, betalt Alunta-abonnement", async () => {
    const c = await listCreditCandidates(db);
    const ours = c.filter((x) => x.orgId.startsWith(tag));
    // paid (active, alunta) ja; lapsed (canceled) nej; store (butik) nej
    expect(ours.map((x) => x.orgId)).toEqual([id("paid")]);
    expect(ours[0].aluntaSubscriptionId).toBe("sub-paid");
  });

  it("output indeholder aldrig navne eller mails", async () => {
    const sel = await selectFoundingOrgs(db, { before: BEFORE, now: NOW });
    const blob = JSON.stringify({ sel, c: await listCreditCandidates(db) });
    expect(blob).not.toMatch(/@example\.invalid/);
    expect(blob).not.toMatch(/org paid|u paid/);
  });
});
