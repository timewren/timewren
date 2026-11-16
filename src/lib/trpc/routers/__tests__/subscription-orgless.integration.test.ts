/**
 * INTEGRATION (CodeRabbit, PR #848): org-løse fallbacks i
 * `resolveActiveSubscription` og `countActiveClients` læste på `userId`
 * alene, uden at kræve `organizationId IS NULL`. Et fjernet medlem, der selv
 * oprettede sin (nu forladte) organisation, har stadig ÉN subscription-række
 * og flere klient-rækker med sit eget `userId` — men med den gamle
 * organisations `organizationId`. Når isAuthed resolver `orgId = null` for
 * et fjernet medlem (ingen medlemskab tilbage), ville den gamle kode stadig
 * finde og returnere den gamle organisations pris, plan og kundeantal.
 *
 * Del 3 (CodeRabbit, PR #848, opfølgning): `resolveActiveSubscription`s
 * userId-fallback, når orgId ER sat men orgen ikke har sin egen række, matchede
 * også userId alene — et medlem flyttet til en ny org uden abonnement kunne
 * dermed arve en TIDLIGERE organisations række. Fallbacken kræver nu
 * `organizationId IS NULL OR organizationId = orgId`.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

// Undgår at routeren åbner en forbindelse til DATABASE_URL ved import —
// testen bruger sin egen TEST_DATABASE_URL-forbindelse.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import { countActiveClients } from "@/lib/billing/plan-limits";
import * as schema from "@/lib/db/schema";
import { clients, subscriptions } from "@/lib/db/schema";
import { resolveActiveSubscription } from "../subscription";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const OLD_ORG = "org-forladt";
const NEW_ORG = "org-ny-uden-abonnement";
const REMOVED_USER = "bruger-fjernet";
const SOLO_USER = "bruger-solo";
const LEGACY_OWNER = "bruger-legacy-ejer";

describe.skipIf(!TEST_DATABASE_URL)(
  "org-løse abonnements- og kundeopslag (integration, #848)",
  () => {
    const scratch = `subscription_orgless_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of ["subscriptions", "clients"]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // Det fjernede medlems subscription — oprettet dengang vedkommende
      // selv checkede ud til organisationen, som nu har smidt dem ud.
      await db.insert(subscriptions).values({
        userId: REMOVED_USER,
        organizationId: OLD_ORG,
        billingCycle: "monthly",
        status: "active",
        planTier: "team",
        trialEndsAt: new Date("2026-01-01T00:00:00Z"),
      });

      // Den gamle organisations kunder — oprettet af det samme medlem.
      await db.insert(clients).values([
        {
          name: "Gammel Org Kunde 1",
          userId: REMOVED_USER,
          organizationId: OLD_ORG,
          isArchived: false,
        },
        {
          name: "Gammel Org Kunde 2",
          userId: REMOVED_USER,
          organizationId: OLD_ORG,
          isArchived: false,
        },
      ]);

      // En rigtig solo-bruger uden org: personlig subscription/kunde uden
      // organizationId. Fixet må ikke bryde dette flow.
      await db.insert(subscriptions).values({
        userId: SOLO_USER,
        organizationId: null,
        billingCycle: "monthly",
        status: "active",
        planTier: "solo",
        trialEndsAt: new Date("2026-01-01T00:00:00Z"),
      });
      await db.insert(clients).values({
        name: "Solo Kunde",
        userId: SOLO_USER,
        organizationId: null,
        isArchived: false,
      });

      // En legacy-ejer (fra før organisationer fandtes): egen subscription-
      // række uden organizationId. Vedkommende er nu medlem af NEW_ORG, som
      // selv ikke har sin egen abonnementsrække endnu.
      await db.insert(subscriptions).values({
        userId: LEGACY_OWNER,
        organizationId: null,
        billingCycle: "monthly",
        status: "active",
        planTier: "solo",
        trialEndsAt: new Date("2026-01-01T00:00:00Z"),
      });
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("giver IKKE det fjernede medlem den forladte organisations abonnement", async () => {
      const sub = await resolveActiveSubscription(db, null, REMOVED_USER);
      expect(sub).toBeNull();
    });

    it("giver stadig org-medlemmer organisationens abonnement", async () => {
      const sub = await resolveActiveSubscription(db, OLD_ORG, REMOVED_USER);
      expect(sub?.organizationId).toBe(OLD_ORG);
    });

    it("giver stadig en solo-bruger sin egen personlige subscription", async () => {
      const sub = await resolveActiveSubscription(db, null, SOLO_USER);
      expect(sub?.userId).toBe(SOLO_USER);
      expect(sub?.organizationId).toBeNull();
    });

    it("giver IKKE et medlem flyttet til en ny org uden abonnement den gamle orgs række", async () => {
      // REMOVED_USER's eneste subscription-række peger på OLD_ORG. Et kald
      // med NEW_ORG (som ikke har sin egen række) må ALDRIG falde tilbage
      // til den række, da den tilhører en anden organisation.
      const sub = await resolveActiveSubscription(db, NEW_ORG, REMOVED_USER);
      expect(sub).toBeNull();
    });

    it("giver stadig en legacy-ejer sin org-løse række, selv som medlem af en org uden abonnement", async () => {
      const sub = await resolveActiveSubscription(db, NEW_ORG, LEGACY_OWNER);
      expect(sub?.userId).toBe(LEGACY_OWNER);
      expect(sub?.organizationId).toBeNull();
    });

    it("tæller IKKE den forladte organisations kunder for det fjernede medlem", async () => {
      expect(await countActiveClients(db, null, REMOVED_USER)).toBe(0);
    });

    it("tæller stadig organisationens kunder for et aktivt medlem", async () => {
      expect(await countActiveClients(db, OLD_ORG, REMOVED_USER)).toBe(2);
    });

    it("tæller stadig en solo-brugers egne kunder", async () => {
      expect(await countActiveClients(db, null, SOLO_USER)).toBe(1);
    });
  },
);
