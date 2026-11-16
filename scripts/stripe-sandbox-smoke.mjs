/**
 * Røgtest af stripe-SDK'et mod Stripe-sandboxen (aldrig live).
 *
 * Kør:  set -a; . ~/dev/secrets/stripe-sandbox.env; set +a
 *       node scripts/stripe-sandbox-smoke.mjs
 *
 * Nægter at køre, hvis STRIPE_SECRET_KEY ikke starter med sk_test_. Printer kun
 * status pr. trin, aldrig nøgle eller kunde-id'er. Rydder op bagefter: den
 * checkout-session, produkt og pris scriptet opretter, udløbes/arkiveres.
 *
 * Checkout-parametrene spejler buildDesktopCheckoutSessionParams i
 * src/lib/trpc/routers/desktop.ts (holdes i hånden, da den ligger i TS).
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY ?? "";
if (!key.startsWith("sk_test_")) {
  console.error(
    "Afbrudt: STRIPE_SECRET_KEY mangler eller er ikke en sk_test_-nøgle.",
  );
  process.exit(2);
}

const stripe = new Stripe(key);
const results = [];
const cleanup = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`OK    ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`FEJL  ${name} — ${err?.type ?? "Error"}: ${err?.message}`);
  }
}

function apiVersionOf(resp) {
  return resp?.lastResponse?.headers?.["stripe-version"] ?? "ukendt";
}

let priceId;
let session;

await step("Sandbox-konto nås (og er ikke live)", async () => {
  const bal = await stripe.balance.retrieve();
  if (bal.livemode) throw new Error("livemode=true — afbryder");
  return `livemode=false, API-version ${apiVersionOf(bal)}`;
});

await step("Opret testprodukt + engangspris (DKK)", async () => {
  const product = await stripe.products.create({
    name: "smoke-test desktop lifetime (slettes)",
  });
  cleanup.push(() => stripe.products.update(product.id, { active: false }));
  const price = await stripe.prices.create({
    product: product.id,
    currency: "dkk",
    unit_amount: 49900,
  });
  priceId = price.id;
  cleanup.push(() => stripe.prices.update(price.id, { active: false }));
});

await step("checkout.sessions.create med licenskøbets parametre", async () => {
  const appUrl = "https://example.invalid";
  session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: "smoke-test@example.invalid",
    customer_creation: "always",
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    invoice_creation: {
      enabled: true,
      invoice_data: { metadata: { product: "desktop_lifetime" } },
    },
    allow_promotion_codes: true,
    success_url: `${appUrl}/download/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/download?canceled=1`,
    metadata: { tier: "lifetime", license_tier: "lifetime", max_devices: "3" },
  });
  cleanup.push(async () => {
    const s = await stripe.checkout.sessions.retrieve(session.id);
    if (s.status === "open") await stripe.checkout.sessions.expire(session.id);
  });
  if (!session.url?.startsWith("https://checkout.stripe.com/"))
    throw new Error("session.url mangler eller har uventet form");
  return `status=${session.status}, url ok`;
});

await step("checkout.sessions.retrieve returnerer samme felter", async () => {
  const s = await stripe.checkout.sessions.retrieve(session.id);
  const m = s.metadata ?? {};
  if (m.tier !== "lifetime" || m.max_devices !== "3")
    throw new Error("metadata matcher ikke");
  if (s.amount_total !== 49900 || s.currency !== "dkk")
    throw new Error(`beløb/valuta uventet: ${s.amount_total} ${s.currency}`);
  if (s.mode !== "payment") throw new Error(`mode=${s.mode}`);
  // webhook-handleren læser disse felter
  for (const f of [
    "payment_intent",
    "customer",
    "customer_details",
    "subscription",
  ])
    if (!(f in s)) throw new Error(`felt mangler på Session: ${f}`);
  return `status=${s.status}, payment_intent=${s.payment_intent === null ? "null (før betaling)" : "sat"}`;
});

let pi;
await step("PaymentIntent (pm_card_visa) bekræftes", async () => {
  pi = await stripe.paymentIntents.create({
    amount: 49900,
    currency: "dkk",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
  });
  if (pi.status !== "succeeded") throw new Error(`status=${pi.status}`);
  return `status=${pi.status}`;
});

await step(
  "paymentIntents.retrieve + expand latest_charge (kvittering)",
  async () => {
    const got = await stripe.paymentIntents.retrieve(pi.id, {
      expand: ["latest_charge"],
    });
    const charge = got.latest_charge;
    if (!charge || typeof charge === "string")
      throw new Error("latest_charge ikke expanderet");
    return `receipt_url ${charge.receipt_url ? "findes" : "mangler"}`;
  },
);

await step("refunds.create({payment_intent}) fuld refundering", async () => {
  const refund = await stripe.refunds.create({ payment_intent: pi.id });
  if (!["succeeded", "pending"].includes(refund.status))
    throw new Error(`refund.status=${refund.status}`);
  return `status=${refund.status}`;
});

await step(
  "Charge efter refundering: refunded=true og payment_intent sat",
  async () => {
    const got = await stripe.paymentIntents.retrieve(pi.id, {
      expand: ["latest_charge"],
    });
    const charge = got.latest_charge;
    if (!charge || typeof charge === "string")
      throw new Error("latest_charge mangler");
    if (charge.refunded !== true)
      throw new Error(`refunded=${charge.refunded}`);
    const piRef =
      typeof charge.payment_intent === "string"
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (piRef !== pi.id) throw new Error("charge.payment_intent matcher ikke");
    return "refunded=true, payment_intent matcher";
  },
);

await step("invoices.list({customer, limit:1}) kan kaldes", async () => {
  // Intet kundeobjekt oprettes af scriptet; kald uden kundefilter er nok til at
  // dække endpoint/parametre/svarform (myLicenseBilling bruger customer-filter).
  const list = await stripe.invoices.list({ limit: 1 });
  if (!Array.isArray(list.data)) throw new Error("data er ikke en liste");
  return `${list.data.length} faktura(er) i svar`;
});

await step(
  "webhooks.constructEvent: gyldig, forkert secret, gammelt tidsstempel",
  async () => {
    const secret = "whsec_smoke_test";
    const payload = JSON.stringify({
      id: "evt_smoke",
      object: "event",
      type: "charge.refunded",
      data: { object: { id: "ch_smoke", object: "charge", refunded: true } },
    });
    const ok = stripe.webhooks.generateTestHeaderString({ payload, secret });
    const ev = stripe.webhooks.constructEvent(payload, ok, secret);
    if (ev.type !== "charge.refunded") throw new Error("event.type forkert");

    const expectThrow = (label, fn) => {
      try {
        fn();
      } catch {
        return;
      }
      throw new Error(`${label} blev ikke afvist`);
    };
    expectThrow("forkert secret", () =>
      stripe.webhooks.constructEvent(
        payload,
        stripe.webhooks.generateTestHeaderString({
          payload,
          secret: "whsec_other",
        }),
        secret,
      ),
    );
    expectThrow("gammelt tidsstempel", () =>
      stripe.webhooks.constructEvent(
        payload,
        stripe.webhooks.generateTestHeaderString({
          payload,
          secret,
          timestamp: Math.floor(Date.now() / 1000) - 600,
        }),
        secret,
      ),
    );
    return "gyldig ok, forkert secret afvist, 10 min gammel afvist (standard-tolerance 300 s)";
  },
);

for (const fn of cleanup.reverse()) {
  try {
    await fn();
  } catch (err) {
    console.log(`ADVARSEL oprydning fejlede — ${err?.message}`);
  }
}
console.log(
  "Oprydning: session udløbet, produkt og pris arkiveret (refunds bliver stående).",
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} trin OK`);
process.exit(failed ? 1 : 0);
