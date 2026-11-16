import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";
import { claimIdleStamp, stampIdle } from "../idle-claim";

// Klippet af idle-stemplet SKAL være atomisk: kun én af web/extension må få
// tidspunktet, ellers spørges brugeren to gange om det samme fravær, og to
// "Fjern"-klik trækker tiden fra dobbelt (#588).
//
// Det kan kun verificeres mod en rigtig Postgres — rækkelåsen (FOR UPDATE) og
// EvalPlanQual-gen-tjekket af UPDATE'ens WHERE findes ikke i en attrap. Uden
// TEST_DATABASE_URL skippes blokken (samme mønster som account-deletion-
// testen); CI sætter variablen.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "claimIdleStamp — atomisk klip (integration)",
  () => {
    const schema = `idle_claim_${Date.now()}`;
    const IDLE_AT = new Date("2026-09-16T14:02:00Z");

    // Admin-forbindelsen laver skemaet; pool'en åbner FLERE forbindelser, som
    // alle skal pege på testskemaet — derfor search_path som
    // connection-parameter, ikke et løst SET på én forbindelse.
    //
    // `idle_detected_at` er `timestamp without time zone`, og wire-strengen
    // har ingen zone. Postgres-js' EGEN default-parser for den type gør bare
    // `new Date(x)`, hvilket V8 læser som LOKAL tid, fordi strengen ("2026-…
    // 14:02:00", med mellemrum, ikke "T") ikke matcher det strikte
    // ISO-format. Under TZ=Europe/Copenhagen gav det et "sandt" tidsstempel
    // 1-2 timer forskudt fra det appen faktisk gemte og læste. Drizzle (den
    // `db` testen ellers bruger) patcher dette parser-hul på klientniveau,
    // men `admin` er en rå postgres-js-klient uden om Drizzle — den skal
    // derfor selv parse kolonnen som UTC, ligesom appens `parseDbTimestamp`.
    const admin = testPostgres({
      max: 1,
      types: {
        timestampUtc: {
          to: 1114,
          from: [1114],
          parse: (value: string) => new Date(`${value}+0000`),
          // Postgres fortæller klienten at $1-parametre mod `idle_detected_at`
          // har OID 1114, selv når værdien testen giver er en ISO-streng
          // (`IDLE_AT.toISOString()`), ikke et Date-objekt — begge skal kunne
          // serialiseres, ligesom postgres-js' indbyggede `date`-type gør.
          serialize: (value: Date | string) =>
            value instanceof Date ? value.toISOString() : String(value),
        },
      },
    });
    let pool: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
      await connectTestDb(admin);
      await admin.unsafe(`CREATE SCHEMA ${schema}`);
      await admin.unsafe(`
        CREATE TABLE ${schema}.timer_states (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL UNIQUE,
          is_idle boolean DEFAULT false,
          idle_detected_at timestamp,
          last_activity_at timestamp,
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `);

      pool = testPostgres({
        max: 4,
        connection: { search_path: schema },
      });
      await connectTestDb(pool);
      db = drizzle(pool);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });

    // Kolonnen er `timestamp without time zone`, så den værdi driveren læser
    // tilbage afhænger af sessionens tidszone. Testene sammenligner derfor med
    // det DB'en FAKTISK har gemt, ikke med ISO-literalen.
    let storedIdleAt: Date;

    beforeEach(async () => {
      await admin.unsafe(`DELETE FROM ${schema}.timer_states`);
      await admin.unsafe(
        `INSERT INTO ${schema}.timer_states (user_id, is_idle, idle_detected_at)
         VALUES ('u1', true, $1)`,
        [IDLE_AT.toISOString()],
      );
      const before = await readRow();
      storedIdleAt = before.idle_detected_at as Date;
    });

    async function readRow() {
      const [row] = await admin.unsafe(
        `SELECT is_idle, idle_detected_at, last_activity_at
         FROM ${schema}.timer_states WHERE user_id = 'u1'`,
      );
      return row as unknown as {
        is_idle: boolean;
        idle_detected_at: Date | null;
        last_activity_at: Date | null;
      };
    }

    it("giver tidspunktet til den FØRSTE klient og null til den næste", async () => {
      const first = await claimIdleStamp(db, "u1");
      const second = await claimIdleStamp(db, "u1");

      expect(first?.getTime()).toBe(storedIdleAt.getTime());
      expect(second).toBeNull();
    });

    it("rydder stemplet og idle-flaget", async () => {
      await claimIdleStamp(db, "u1");
      const row = await readRow();
      expect(row.is_idle).toBe(false);
      expect(row.idle_detected_at).toBeNull();
    });

    it("giver null når der slet ikke er registreret inaktivitet", async () => {
      await admin.unsafe(
        `UPDATE ${schema}.timer_states
         SET is_idle = false, idle_detected_at = NULL WHERE user_id = 'u1'`,
      );
      expect(await claimIdleStamp(db, "u1")).toBeNull();
    });

    it("opdaterer last_activity_at også for den klient der tabte klippet", async () => {
      await admin.unsafe(
        `UPDATE ${schema}.timer_states
         SET last_activity_at = '2000-01-01T00:00:00Z' WHERE user_id = 'u1'`,
      );
      // Andet kald taber klippet (stemplet er væk) — men skal stadig
      // opdatere last_activity_at, som idle-warning-cron'en læser.
      await claimIdleStamp(db, "u1");
      const afterWinner = await readRow();
      await claimIdleStamp(db, "u1");
      const afterLoser = await readRow();

      expect(afterWinner.last_activity_at?.getFullYear()).toBeGreaterThan(2020);
      expect(
        afterLoser.last_activity_at?.getTime() ?? 0,
      ).toBeGreaterThanOrEqual(afterWinner.last_activity_at?.getTime() ?? 0);
    });

    it("lader kun ÉN af to samtidige klip vinde", async () => {
      const [a, b] = await Promise.all([
        claimIdleStamp(db, "u1"),
        claimIdleStamp(db, "u1"),
      ]);
      const winners = [a, b].filter((value) => value !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.getTime()).toBe(storedIdleAt.getTime());
    });

    // Den EGENTLIGE race: B rammer rækken mens A's transaktion stadig holder
    // låsen. B blokerer, og når A comitter, kører Postgres EvalPlanQual —
    // som kun gen-tjekker UPDATE'ens egen WHERE, ikke CTE'ens. Uden
    // `FOR UPDATE` + `AND t.idle_detected_at IS NOT NULL` får B det gamle,
    // non-null stempel, og brugeren bliver spurgt to gange om samme fravær.
    it("giver taberen null selv når klippene overlapper i tid", async () => {
      let releaseA!: () => void;
      const aMayCommit = new Promise<void>((resolve) => {
        releaseA = resolve;
      });

      const aPromise = db.transaction(async (tx) => {
        const claimed = await claimIdleStamp(tx, "u1");
        await aMayCommit; // hold transaktionen — og rækkelåsen — åben
        return claimed;
      });

      // Lad A nå at tage låsen, start så B: den blokerer på rækken.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const bPromise = claimIdleStamp(db, "u1");
      await new Promise((resolve) => setTimeout(resolve, 250));
      releaseA();

      const [a, b] = await Promise.all([aPromise, bPromise]);

      expect(a?.getTime()).toBe(storedIdleAt.getTime());
      expect(b).toBeNull();
    });

    // Hele forløbet gennem DE SAMME funktioner routerne kalder. En ren
    // enhedstest af beslutningslogikken fangede ikke at postgres-js ikke kan
    // binde et JS-Date i en rå sql-skabelon — det gav 500 på reportIdle i
    // beta, fordi Postgres ikke kan COALESCE(timestamp, text).
    describe("fuldt idle-flow", () => {
      beforeEach(async () => {
        // Frisk timer uden idle-historik: som lige efter en start.
        await admin.unsafe(
          `UPDATE ${schema}.timer_states
           SET is_idle = false, idle_detected_at = NULL WHERE user_id = 'u1'`,
        );
      });

      it("stempler, holder fast i FØRSTE stempel, og lader kun én klient klippe", async () => {
        // 1) Web ser inaktivitet.
        const first = await stampIdle(db, "u1");
        expect(first).not.toBeNull();

        // 2) Extensionen ser den samme inaktivitet et øjeblik senere. Stemplet
        //    må IKKE flytte sig — ellers krymper det målte fravær.
        await new Promise((resolve) => setTimeout(resolve, 50));
        const second = await stampIdle(db, "u1");
        expect(second?.getTime()).toBe(first?.getTime());

        const stamped = await readRow();
        expect(stamped.is_idle).toBe(true);
        expect(stamped.idle_detected_at?.getTime()).toBe(first?.getTime());

        // 3) Brugeren er tilbage: web og extension klipper samtidig.
        const [a, b] = await Promise.all([
          claimIdleStamp(db, "u1"),
          claimIdleStamp(db, "u1"),
        ]);
        const winners = [a, b].filter((value) => value !== null);
        expect(winners).toHaveLength(1);
        expect(winners[0]?.getTime()).toBe(first?.getTime());

        // 4) En tredje klient (eller et gentaget focus-event) får ingenting.
        expect(await claimIdleStamp(db, "u1")).toBeNull();

        const cleared = await readRow();
        expect(cleared.is_idle).toBe(false);
        expect(cleared.idle_detected_at).toBeNull();
      });

      it("kan stemple igen efter et klip (næste fravær)", async () => {
        const firstAway = await stampIdle(db, "u1");
        expect(await claimIdleStamp(db, "u1")).not.toBeNull();

        await new Promise((resolve) => setTimeout(resolve, 50));
        const secondAway = await stampIdle(db, "u1");
        expect(secondAway).not.toBeNull();
        expect(secondAway?.getTime()).toBeGreaterThan(
          firstAway?.getTime() ?? 0,
        );
      });
    });
  },
);
