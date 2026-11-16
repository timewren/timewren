import { beforeEach, describe, expect, it } from "vitest";
import type { AluntaSubscription } from "@/lib/alunta";
import {
  canAutoExpandTier,
  pickSeatsSubToExpand,
  seatsAfterExpand,
  seatsSyncPlan,
} from "./auto-seats-rules";

const SEATS_PLAN = "seats-plan-uuid";
const BASE_PLAN = "base-plan-uuid";

function sub(over: Partial<AluntaSubscription>): AluntaSubscription {
  return {
    uuid: "u",
    status: "active",
    end_date: null,
    external_customer_id: null,
    metadata: null,
    interval: 12,
    trial: null,
    ...over,
  };
}

describe("auto-seats", () => {
  beforeEach(() => {
    process.env.ALUNTA_PLAN_TEAM_SEATS = SEATS_PLAN;
    process.env.ALUNTA_PLAN_BUSINESS_SEATS = "biz-seats";
  });

  describe("canAutoExpandTier", () => {
    it("tillader kun live Team/Business med Alunta-kobling", () => {
      expect(
        canAutoExpandTier({
          planTier: "team",
          status: "trialing",
          aluntaSubscriptionId: "x",
        }),
      ).toBe(true);
      expect(
        canAutoExpandTier({
          planTier: "solo",
          status: "active",
          aluntaSubscriptionId: "x",
        }),
      ).toBe(false);
      expect(
        canAutoExpandTier({
          planTier: "team",
          status: "canceled",
          aluntaSubscriptionId: "x",
        }),
      ).toBe(false);
      expect(
        canAutoExpandTier({
          planTier: "business",
          status: "active",
          aluntaSubscriptionId: null,
        }),
      ).toBe(false);
    });
  });

  describe("pickSeatsSubToExpand", () => {
    it("vælger det live seats-add-on med højest quantity, ignorerer base og døde", () => {
      const picked = pickSeatsSubToExpand([
        sub({
          uuid: "base",
          plan: { uuid: BASE_PLAN, name: "Base" },
          quantity: 1,
        }),
        sub({
          uuid: "old",
          plan: { uuid: SEATS_PLAN, name: "Seats" },
          quantity: 9,
          status: "cancelled",
        }),
        sub({
          uuid: "s3",
          plan: { uuid: SEATS_PLAN, name: "Seats" },
          quantity: 3,
        }),
        sub({
          uuid: "s5",
          plan: { uuid: SEATS_PLAN, name: "Seats" },
          quantity: 5,
        }),
      ]);
      expect(picked?.uuid).toBe("s5");
    });

    it("returnerer null uden seats-add-on", () => {
      expect(
        pickSeatsSubToExpand([
          sub({ plan: { uuid: BASE_PLAN, name: "Base" }, quantity: 1 }),
        ]),
      ).toBeNull();
    });
  });

  describe("seatsAfterExpand", () => {
    it("er inkluderede pladser + ny add-on-quantity", () => {
      // Team inkluderer 2
      expect(seatsAfterExpand("team", 4)).toBe(6);
      // Business inkluderer 5
      expect(seatsAfterExpand("business", 1)).toBe(6);
    });

    it("clamper til tierens loft", () => {
      expect(seatsAfterExpand("team", 999)).toBeLessThanOrEqual(25);
    });
  });

  describe("seatsSyncPlan — betal kun for pladser i brug", () => {
    it("Team med 5 i brug: quantity 3, maxSeats 5", () => {
      expect(
        seatsSyncPlan({
          tier: "team",
          seatsUsed: 5,
          currentQuantity: 13,
          currentMaxSeats: 15,
        }),
      ).toEqual({
        targetQuantity: 3,
        targetMaxSeats: 5,
        changeQuantity: true,
        changeMaxSeats: true,
      });
    });

    it("skruer op ved invitation (reserve) og ned ved fjernelse", () => {
      expect(
        seatsSyncPlan({
          tier: "team",
          seatsUsed: 6,
          currentQuantity: 3,
          currentMaxSeats: 5,
        }).targetQuantity,
      ).toBe(4);
      expect(
        seatsSyncPlan({
          tier: "team",
          seatsUsed: 4,
          currentQuantity: 3,
          currentMaxSeats: 5,
        }).targetQuantity,
      ).toBe(2);
    });

    it("går aldrig under 0 ekstra pladser", () => {
      const plan = seatsSyncPlan({
        tier: "team",
        seatsUsed: 1,
        currentQuantity: 3,
        currentMaxSeats: 5,
      });
      expect(plan.targetQuantity).toBe(0);
      expect(plan.targetMaxSeats).toBe(2);
    });

    it("er no-op når forbruget allerede matcher", () => {
      const plan = seatsSyncPlan({
        tier: "business",
        seatsUsed: 7,
        currentQuantity: 2,
        currentMaxSeats: 7,
      });
      expect(plan.changeQuantity).toBe(false);
      expect(plan.changeMaxSeats).toBe(false);
    });
  });
});
