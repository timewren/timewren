/**
 * 1 måned gratis til Founding-kunder via Alunta.
 *
 *   npx tsx scripts/founding/credit-month.ts                 # dry-run (standard)
 *   CONFIRM_ALUNTA_WRITE=1 npx tsx scripts/founding/credit-month.ts --apply
 *
 * Mekanisme: Alunta-klienten har `subscriptions.addDiscount` (POST
 * /subscriptions/{uuid}/discounts). Månedlig: 100 % rabat fra nuværende
 * periodes slutning og en måned frem. Årlige springes over (manuel kreditnota i Alunta).
 * Idempotent: springer abonnementer over, der allerede har rabatten
 * "Founding: 1 måned gratis" i Alunta.
 *
 * Dry-run rører ikke Alunta. Udskriver kun org-id, abonnement-uuid og beløb.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { alunta } from "../../src/lib/alunta";
import { cycleListPriceForSubscription } from "../../src/lib/config";
import { CREDIT_DISCOUNT_NAME, listCreditCandidates, planCredit } from "./lib";

/** Gennemgår alle sider, så rabatten ikke overses på side 2+. */
async function hasCredit(uuid: string): Promise<boolean> {
  for (let page = 1; page <= 50; page++) {
    const res = await alunta.subscriptions.listDiscounts(uuid, page);
    if (res.data.some((d) => d.discount_name === CREDIT_DISCOUNT_NAME)) {
      return true;
    }
    if (!res.meta || page >= res.meta.last_page) return false;
  }
  throw new Error(`for mange rabatsider for ${uuid}, stopper`);
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    throw new Error("--apply og --dry-run kan ikke bruges sammen");
  }
  if (apply && process.env.CONFIRM_ALUNTA_WRITE !== "1") {
    throw new Error("--apply kræver CONFIRM_ALUNTA_WRITE=1");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL mangler");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  try {
    const candidates = await listCreditCandidates(db);
    console.log(`Tilstand: ${apply ? "APPLY" : "dry-run"}`);
    console.log(
      `Founding-orgs med aktivt betalt abonnement: ${candidates.length}`,
    );
    let total = 0;
    let done = 0;
    for (const c of candidates) {
      const cyclePrice = cycleListPriceForSubscription(c);
      const monthly =
        c.billingCycle === "yearly" ? cyclePrice / 12 : cyclePrice;
      const plan = planCredit(c, monthly);
      const label = `org=${c.orgId} abonnement=${c.aluntaSubscriptionId}`;
      if ("skip" in plan) {
        console.log(`  ${label} SPRINGES OVER: ${plan.skip}`);
        continue;
      }
      total += plan.amount;
      console.log(
        `  ${label} beløb=${plan.amount.toFixed(2)} DKK (${plan.discount.discount_type} ${plan.discount.discount_value}, ${plan.discount.from_date} til ${plan.discount.to_date})`,
      );
      if (!apply) continue;
      if (await hasCredit(c.aluntaSubscriptionId)) {
        console.log("    allerede krediteret, springer over");
        continue;
      }
      await alunta.subscriptions.addDiscount(
        c.aluntaSubscriptionId,
        plan.discount,
      );
      done++;
      console.log("    rabat oprettet");
    }
    console.log(`Samlet beløb: ${total.toFixed(2)} DKK`);
    if (apply) console.log(`Oprettet nu: ${done}`);
    else console.log("Intet ændret (dry-run).");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "ukendt fejl");
  process.exit(1);
});
