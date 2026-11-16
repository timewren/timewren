import { describe, expect, it } from "vitest";
import {
  appleProduct,
  googleProduct,
  STORE_PRODUCTS,
  storeManageUrl,
} from "../products";
import {
  type CurrentSourceRow,
  currentFromRow,
  deriveAppleSnapshot,
  deriveGoogleSnapshot,
  type GooglePurchaseData,
  hasActiveWebSubscription,
  isIgnored,
  isStoreManaged,
  rowStatusForStoreState,
  type StoreSnapshot,
} from "../state";

const NOW = new Date("2026-10-23T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function snap(r: ReturnType<typeof deriveAppleSnapshot>): StoreSnapshot {
  if (isIgnored(r)) throw new Error(`ignored: ${r.ignored}`);
  return r;
}

describe("produktkatalog (kontrakten)", () => {
  it("har præcis Privat og Selvstændig, måned og år, på begge platforme", () => {
    expect(STORE_PRODUCTS).toHaveLength(8);
    expect(
      STORE_PRODUCTS.filter((p) => p.platform === "ios").map(
        (p) => p.productId,
      ),
    ).toEqual([
      "dk.timetrack.app.privat.monthly",
      "dk.timetrack.app.privat.yearly",
      "dk.timetrack.app.solo.monthly",
      "dk.timetrack.app.solo.yearly",
    ]);
    expect(googleProduct("solo", "yearly")).toMatchObject({
      planTier: "solo",
      cycle: "yearly",
    });
    expect(appleProduct("dk.timetrack.app.privat.monthly")).toMatchObject({
      planTier: "privat",
      cycle: "monthly",
    });
  });

  it("kender ikke Team/Virksomhed eller fremmede produkter", () => {
    expect(appleProduct("dk.timetrack.app.team.monthly")).toBeNull();
    expect(googleProduct("solo", "weekly")).toBeNull();
    expect(googleProduct("team", "monthly")).toBeNull();
  });

  it("linker til butikkens abonnementsside", () => {
    expect(storeManageUrl("apple")).toBe(
      "https://apps.apple.com/account/subscriptions",
    );
    expect(storeManageUrl("google", "solo")).toBe(
      "https://play.google.com/store/account/subscriptions?package=dk.timetrack.app&sku=solo",
    );
  });
});

describe("deriveAppleSnapshot", () => {
  const tx = {
    originalTransactionId: "2000000111",
    productId: "dk.timetrack.app.solo.monthly",
    purchaseDate: NOW.getTime() - DAY,
    expiresDate: NOW.getTime() + 29 * DAY,
    environment: "Production",
    signedDate: NOW.getTime() - 1000,
  };

  it("aktivt abonnement → active med plan, periode og miljø", () => {
    const s = snap(deriveAppleSnapshot({ transaction: tx, now: NOW }));
    expect(s).toMatchObject({
      provider: "apple",
      planTier: "solo",
      cycle: "monthly",
      storeState: "active",
      environment: "Production",
      originalTransactionId: "2000000111",
      autoRenew: null,
    });
    expect(s.periodEnd?.getTime()).toBe(tx.expiresDate);
    expect(s.eventAt.getTime()).toBe(tx.signedDate);
  });

  it("opsagt (auto-renew slået fra) → stadig active, autoRenew false", () => {
    const s = snap(
      deriveAppleSnapshot({
        transaction: tx,
        renewalInfo: { autoRenewStatus: 0 },
        now: NOW,
      }),
    );
    expect(s.storeState).toBe("active");
    expect(s.autoRenew).toBe(false);
  });

  it("refunderet/tilbagekaldt → revoked, selv før udløb", () => {
    const s = snap(
      deriveAppleSnapshot({
        transaction: { ...tx, revocationDate: NOW.getTime() - 1000 },
        now: NOW,
      }),
    );
    expect(s.storeState).toBe("revoked");
    expect(rowStatusForStoreState(s.storeState)).toBe("canceled");
  });

  it("udløbet i grace period → grace_period (adgang bevares)", () => {
    const s = snap(
      deriveAppleSnapshot({
        transaction: { ...tx, expiresDate: NOW.getTime() - DAY },
        renewalInfo: {
          isInBillingRetryPeriod: true,
          gracePeriodExpiresDate: NOW.getTime() + 5 * DAY,
        },
        now: NOW,
      }),
    );
    expect(s.storeState).toBe("grace_period");
    expect(rowStatusForStoreState(s.storeState)).toBe("active");
  });

  it("udløbet i billing retry uden grace → billing_retry (Gratis)", () => {
    const s = snap(
      deriveAppleSnapshot({
        transaction: { ...tx, expiresDate: NOW.getTime() - DAY },
        renewalInfo: { isInBillingRetryPeriod: true },
        now: NOW,
      }),
    );
    expect(s.storeState).toBe("billing_retry");
    expect(rowStatusForStoreState(s.storeState)).toBe("canceled");
  });

  it("udløbet uden retry → expired", () => {
    const s = snap(
      deriveAppleSnapshot({
        transaction: { ...tx, expiresDate: NOW.getTime() - DAY },
        renewalInfo: { isInBillingRetryPeriod: false, autoRenewStatus: 0 },
        now: NOW,
      }),
    );
    expect(s.storeState).toBe("expired");
  });

  it("Sandbox-transaktion bevarer miljøet", () => {
    const s = snap(
      deriveAppleSnapshot({
        transaction: { ...tx, environment: "Sandbox" },
        now: NOW,
      }),
    );
    expect(s.environment).toBe("Sandbox");
  });

  it("opgraderet (erstattet) transaktion ignoreres", () => {
    expect(
      deriveAppleSnapshot({
        transaction: { ...tx, isUpgraded: true },
        now: NOW,
      }),
    ).toEqual({ ignored: "superseded" });
  });

  it("ukendt produkt og manglende data ignoreres", () => {
    expect(
      deriveAppleSnapshot({
        transaction: { ...tx, productId: "dk.timetrack.app.team.monthly" },
        now: NOW,
      }),
    ).toEqual({ ignored: "unknown_product" });
    expect(
      deriveAppleSnapshot({
        transaction: { ...tx, originalTransactionId: undefined },
        now: NOW,
      }),
    ).toEqual({ ignored: "missing_data" });
  });

  it("notifikationens tidspunkt vinder over transaktionens", () => {
    const eventAt = new Date(NOW.getTime() + 5000);
    const s = snap(deriveAppleSnapshot({ transaction: tx, now: NOW, eventAt }));
    expect(s.eventAt).toEqual(eventAt);
  });
});

describe("deriveGoogleSnapshot", () => {
  const base: GooglePurchaseData = {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
    lineItems: [
      {
        productId: "privat",
        expiryTime: new Date(NOW.getTime() + 300 * DAY).toISOString(),
        autoRenewingPlan: { autoRenewEnabled: true },
        offerDetails: { basePlanId: "yearly" },
      },
    ],
  };
  const derive = (p: Partial<GooglePurchaseData>) =>
    deriveGoogleSnapshot({
      purchase: { ...base, ...p },
      purchaseToken: "tok-1",
      now: NOW,
    });

  it("aktivt → active med plan fra produkt + basisplan", () => {
    const s = snap(derive({}));
    expect(s).toMatchObject({
      provider: "google",
      productId: "privat",
      planTier: "privat",
      cycle: "yearly",
      storeState: "active",
      autoRenew: true,
      purchaseToken: "tok-1",
      environment: "Production",
    });
  });

  it.each([
    ["SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "grace_period"],
    ["SUBSCRIPTION_STATE_ON_HOLD", "billing_retry"],
    ["SUBSCRIPTION_STATE_PAUSED", "paused"],
    ["SUBSCRIPTION_STATE_EXPIRED", "expired"],
  ])("%s → %s", (state, expected) => {
    expect(snap(derive({ subscriptionState: state })).storeState).toBe(
      expected,
    );
  });

  it("opsagt men betalt periode → active med autoRenew false", () => {
    const s = snap(
      derive({ subscriptionState: "SUBSCRIPTION_STATE_CANCELED" }),
    );
    expect(s.storeState).toBe("active");
    expect(s.autoRenew).toBe(false);
  });

  it("opsagt og udløbet → expired", () => {
    const s = snap(
      derive({
        subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
        lineItems: [
          {
            ...base.lineItems?.[0],
            expiryTime: new Date(NOW.getTime() - DAY).toISOString(),
          },
        ],
      }),
    );
    expect(s.storeState).toBe("expired");
  });

  it("afventende betaling ignoreres (ingen adgang, ingen acknowledge)", () => {
    expect(derive({ subscriptionState: "SUBSCRIPTION_STATE_PENDING" })).toEqual(
      { ignored: "pending" },
    );
  });

  it("testkøb markeres som Sandbox", () => {
    expect(snap(derive({ testPurchase: {} })).environment).toBe("Sandbox");
  });

  it("ukendt basisplan ignoreres", () => {
    expect(
      derive({
        lineItems: [{ productId: "solo", offerDetails: { basePlanId: "x" } }],
      }),
    ).toEqual({ ignored: "unknown_product" });
  });
});

describe("isStoreManaged / hasActiveWebSubscription", () => {
  it("butiksrækker ejes af butikken indtil udløb eller refundering", () => {
    expect(
      isStoreManaged({ storeProvider: "apple", storeStatus: "active" }),
    ).toBe(true);
    expect(
      isStoreManaged({ storeProvider: "google", storeStatus: "billing_retry" }),
    ).toBe(true);
    expect(
      isStoreManaged({ storeProvider: "apple", storeStatus: "expired" }),
    ).toBe(false);
    expect(
      isStoreManaged({ storeProvider: "google", storeStatus: "revoked" }),
    ).toBe(false);
    expect(isStoreManaged({ storeProvider: null, storeStatus: null })).toBe(
      false,
    );
  });

  it("web-abonnement er løbende med Alunta-link og live status", () => {
    const web = { aluntaSubscriptionId: "a-1", storeProvider: null };
    expect(hasActiveWebSubscription({ ...web, status: "active" })).toBe(true);
    expect(hasActiveWebSubscription({ ...web, status: "trialing" })).toBe(true);
    expect(hasActiveWebSubscription({ ...web, status: "past_due" })).toBe(true);
    expect(hasActiveWebSubscription({ ...web, status: "canceled" })).toBe(
      false,
    );
    expect(
      hasActiveWebSubscription({
        aluntaSubscriptionId: null,
        status: "active",
      }),
    ).toBe(false);
    // Butiksejet række med gammelt Alunta-link er ikke et web-abonnement.
    expect(
      hasActiveWebSubscription({
        ...web,
        status: "active",
        storeProvider: "apple",
        storeStatus: "active",
      }),
    ).toBe(false);
  });
});

describe("currentFromRow (kontraktens current)", () => {
  const row: CurrentSourceRow = {
    status: "active",
    planTier: "solo",
    currentPeriodEnd: new Date("2026-11-23T12:00:00Z"),
    cancelAtPeriodEnd: false,
    aluntaSubscriptionId: null,
    storeProvider: null,
    storeStatus: null,
    storeProductId: null,
  };

  it("ingen række → none", () => {
    expect(currentFromRow(null)).toEqual({
      source: "none",
      planTier: null,
      status: "none",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      productId: null,
    });
  });

  it("butiksrække → apple/google med produkt-id", () => {
    expect(
      currentFromRow({
        ...row,
        storeProvider: "apple",
        storeStatus: "active",
        storeProductId: "dk.timetrack.app.solo.monthly",
        aluntaSubscriptionId: "gammelt-web-abo",
      }),
    ).toEqual({
      source: "apple",
      planTier: "solo",
      status: "active",
      currentPeriodEnd: "2026-11-23T12:00:00.000Z",
      cancelAtPeriodEnd: false,
      productId: "dk.timetrack.app.solo.monthly",
    });
  });

  it("løbende Alunta-abonnement → web uden produkt-id", () => {
    expect(
      currentFromRow({ ...row, aluntaSubscriptionId: "a-1" }),
    ).toMatchObject({ source: "web", productId: null });
  });

  it("opsagt web-abonnement → none (kan købes igen i appen)", () => {
    expect(
      currentFromRow({
        ...row,
        aluntaSubscriptionId: "a-1",
        status: "canceled",
      }).source,
    ).toBe("none");
  });

  it("udløbet butiksabonnement uden web → stadig butikken", () => {
    expect(
      currentFromRow({
        ...row,
        status: "canceled",
        storeProvider: "google",
        storeStatus: "expired",
        storeProductId: "solo",
      }),
    ).toMatchObject({ source: "google", status: "canceled" });
  });

  it("prøveperiode uden betaling → none", () => {
    expect(currentFromRow({ ...row, status: "trialing" }).source).toBe("none");
  });
});
