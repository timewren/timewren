import { describe, expect, it } from "vitest";
import {
  findDuplicateSubscriptions,
  formatDuplicateReason,
  isBillingAluntaStatus,
  isPossibleDuplicateEvent,
  isStillBillingAluntaSub,
} from "../duplicate-subscriptions";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "row-1",
  userId: "user-1",
  organizationId: "org-1",
  aluntaCustomerId: "cust-1",
  aluntaSubscriptionId: "linked-1",
  ...overrides,
});

const sub = (uuid: string, customer: string, status = "active") => ({
  uuid,
  status,
  customer: { uuid: customer },
});

describe("isBillingAluntaStatus", () => {
  it("tæller active/trialing/past_due/under_cancellation som faktureret", () => {
    for (const s of ["active", "trialing", "past_due", "under_cancellation"])
      expect(isBillingAluntaStatus(s)).toBe(true);
    expect(isBillingAluntaStatus("ACTIVE")).toBe(true);
  });

  it("tæller cancelled/expired/ended/null som ikke-faktureret", () => {
    for (const s of ["cancelled", "canceled", "expired", "ended", null, ""])
      expect(isBillingAluntaStatus(s)).toBe(false);
  });
});

describe("isStillBillingAluntaSub (opsagte subs der udløber uden fornyelse)", () => {
  it("under_cancellation med end_date sat → fornyer ikke → ikke fakturerende", () => {
    expect(
      isStillBillingAluntaSub({
        status: "under_cancellation",
        end_date: "2026-09-29T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("under_cancellation UDEN end_date → tæller stadig (vi ved ikke at den stopper)", () => {
    expect(
      isStillBillingAluntaSub({ status: "under_cancellation", end_date: null }),
    ).toBe(true);
  });

  it("under_cancellation med end_date EFTER current_period_end → fornyer mindst én gang mere → tæller", () => {
    expect(
      isStillBillingAluntaSub({
        status: "under_cancellation",
        end_date: "2026-10-29T00:00:00Z",
        current_period_end: "2026-09-29T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      isStillBillingAluntaSub({
        status: "under_cancellation",
        end_date: "2026-09-29T00:00:00Z",
        current_period_end: "2026-09-29T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("active og past_due tæller altid — også med end_date sat", () => {
    expect(
      isStillBillingAluntaSub({ status: "active", end_date: "2026-09-29" }),
    ).toBe(true);
    expect(
      isStillBillingAluntaSub({ status: "past_due", end_date: "2026-09-29" }),
    ).toBe(true);
  });

  it("cancelled er aldrig fakturerende", () => {
    expect(isStillBillingAluntaSub({ status: "cancelled" })).toBe(false);
  });
});

describe("findDuplicateSubscriptions (cron-tælleren)", () => {
  it("kunde B-tilfældet: linket + fremmed live sub på samme customer.uuid", () => {
    const findings = findDuplicateSubscriptions(
      [row()],
      [
        sub("linked-1", "cust-1"),
        sub("foreign-1", "cust-1"),
        sub("other", "cust-2"),
      ],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].customerUuid).toBe("cust-1");
    expect(findings[0].linkedSubUuid).toBe("linked-1");
    expect(findings[0].liveSubUuids.sort()).toEqual(["foreign-1", "linked-1"]);
    expect(findings[0].foreignSubUuids).toEqual(["foreign-1"]);
  });

  it("ignorerer kundens døde subs — én live sub er ikke et dobbelt-abo", () => {
    const findings = findDuplicateSubscriptions(
      [row()],
      [
        sub("linked-1", "cust-1"),
        sub("old-1", "cust-1", "cancelled"),
        sub("old-2", "cust-1", "expired"),
      ],
    );
    expect(findings).toEqual([]);
  });

  it("tæller past_due som stadig faktureret", () => {
    const findings = findDuplicateSubscriptions(
      [row()],
      [sub("linked-1", "cust-1"), sub("foreign-1", "cust-1", "past_due")],
    );
    expect(findings).toHaveLength(1);
  });

  it("kunde B efter opsigelse: linket active + fremmed under_cancellation m. end_date → ingen dublet", () => {
    const findings = findDuplicateSubscriptions(
      [row()],
      [
        sub("linked-1", "cust-1"),
        {
          ...sub("foreign-1", "cust-1", "under_cancellation"),
          end_date: "2026-09-29T00:00:00Z",
        },
      ],
    );
    expect(findings).toEqual([]);
  });

  it("fremmed under_cancellation UDEN end_date tæller stadig som dublet", () => {
    const findings = findDuplicateSubscriptions(
      [row()],
      [
        sub("linked-1", "cust-1"),
        sub("foreign-1", "cust-1", "under_cancellation"),
      ],
    );
    expect(findings).toHaveLength(1);
  });

  it("filtrerer klient-side på customer.uuid — andre kunders subs blander sig ikke", () => {
    const findings = findDuplicateSubscriptions(
      [
        row(),
        row({
          id: "row-2",
          aluntaCustomerId: "cust-2",
          aluntaSubscriptionId: "l-2",
        }),
      ],
      [
        sub("linked-1", "cust-1"),
        sub("l-2", "cust-2"),
        sub("x", "cust-3"),
        sub("y", "cust-3"),
        { uuid: "no-customer", status: "active" },
      ],
    );
    expect(findings).toEqual([]);
  });

  it("dedup'er samme uuid på tværs af sider", () => {
    const findings = findDuplicateSubscriptions(
      [row()],
      [sub("linked-1", "cust-1"), sub("linked-1", "cust-1")],
    );
    expect(findings).toEqual([]);
  });

  it("rapporterer også når rækken slet ikke er linket men kunden har to live subs", () => {
    const findings = findDuplicateSubscriptions(
      [row({ aluntaSubscriptionId: null })],
      [sub("a", "cust-1"), sub("b", "cust-1")],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].foreignSubUuids.sort()).toEqual(["a", "b"]);
  });

  it("butiksrække (køb i appen) + ét live Alunta-abo = dobbeltbetaling", () => {
    const findings = findDuplicateSubscriptions(
      [row({ aluntaSubscriptionId: "linked-1", storeManaged: true })],
      [sub("linked-1", "cust-1")],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].linkedSubUuid).toBeNull();
    expect(findings[0].foreignSubUuids).toEqual(["linked-1"]);
  });

  it("butiksrække uden live Alunta-abo er ikke en dublet", () => {
    expect(
      findDuplicateSubscriptions(
        [row({ storeManaged: true })],
        [sub("linked-1", "cust-1", "cancelled")],
      ),
    ).toEqual([]);
  });
});

describe("isPossibleDuplicateEvent (webhook-vagten)", () => {
  const base = {
    linkedSubUuid: "linked-1",
    eventSubUuid: "foreign-1",
    eventSubStatus: "active",
    linkedSubLive: true as boolean | null,
  };

  it("fremmed live sub + linket live sub → dobbelt", () => {
    expect(isPossibleDuplicateEvent(base)).toBe(true);
  });

  it("linket sub kunne ikke verificeres (null) → alarmér hellere", () => {
    expect(isPossibleDuplicateEvent({ ...base, linkedSubLive: null })).toBe(
      true,
    );
  });

  it("linket sub bekræftet død → ikke dobbelt (erstatning, ikke duplikat)", () => {
    expect(isPossibleDuplicateEvent({ ...base, linkedSubLive: false })).toBe(
      false,
    );
  });

  it("eventets sub er ikke faktureret (cancelled) → ikke dobbelt", () => {
    expect(
      isPossibleDuplicateEvent({ ...base, eventSubStatus: "cancelled" }),
    ).toBe(false);
  });

  it("eventets sub er under_cancellation med end_date → udløber uden fornyelse → ikke dobbelt", () => {
    expect(
      isPossibleDuplicateEvent({
        ...base,
        eventSubStatus: "under_cancellation",
        eventSubEndDate: "2026-09-29T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      isPossibleDuplicateEvent({
        ...base,
        eventSubStatus: "under_cancellation",
        eventSubEndDate: null,
      }),
    ).toBe(true);
  });

  it("samme uuid som linket eller ingen linket → ikke dobbelt", () => {
    expect(
      isPossibleDuplicateEvent({ ...base, eventSubUuid: "linked-1" }),
    ).toBe(false);
    expect(isPossibleDuplicateEvent({ ...base, linkedSubUuid: null })).toBe(
      false,
    );
  });
});

describe("formatDuplicateReason", () => {
  it("nævner kilde, kunde, begge uuids og manuel-annullér-instruktionen", () => {
    const text = formatDuplicateReason({
      source: "Webhook subscription.started",
      customerUuid: "cust-1",
      linkedSubUuid: "ef9ba0b3",
      foreignSubUuids: ["956a00b2"],
    });
    expect(text).toContain("cust-1");
    expect(text).toContain("ef9ba0b3");
    expect(text).toContain("956a00b2");
    expect(text).toContain("Muligt dobbelt-abonnement");
    expect(text).toContain("annullér manuelt");
  });
});

describe("formatDuplicateReason for køb i appen", () => {
  it("nævner butikken når rækken også betales i appen", () => {
    const text = formatDuplicateReason({
      source: "Cron alunta-duplicate-subs",
      customerUuid: "cust-1",
      linkedSubUuid: null,
      foreignSubUuids: ["956a00b2"],
      storeLabel: "App Store",
    });
    expect(text).toContain("betales også via App Store");
    expect(text).toContain("956a00b2");
  });
});
