import { FREE_MAX_SEATS } from "@/lib/billing/plan-gate";
import {
  BUSINESS_MAX_SEATS,
  includedSeatsForTier,
  planNameForTier,
  TEAM_MAX_SEATS,
  totalPriceForTierSeats,
} from "@/lib/config";

export type TeamPrisTier = "free" | "team" | "business";

export interface TeamPrisOption {
  tier: TeamPrisTier;
  name: string;
  /** Kan planen dække det valgte antal brugere? */
  available: boolean;
  /** Antal pladser der faktureres (planens minimum, hvis I er færre). */
  billedSeats: number;
  /** Pris ved månedlig betaling (DKK ekskl. moms). */
  monthlyTotal: number;
  /** Pris ved årlig betaling for hele året (DKK ekskl. moms). */
  yearlyTotal: number;
  /** Årsprisen omregnet til pr. måned. */
  yearlyPerMonth: number;
  /** Månedlig pris delt på det faktiske antal brugere. */
  perUserMonthly: number;
}

export interface TeamPrisEstimate {
  users: number;
  options: TeamPrisOption[];
  /** Anbefalet plan, eller null når I er flere end Virksomhed dækker. */
  recommended: TeamPrisTier | null;
}

const MAX_SEATS: Record<TeamPrisTier, number> = {
  free: FREE_MAX_SEATS,
  team: TEAM_MAX_SEATS,
  business: BUSINESS_MAX_SEATS,
};

function option(tier: TeamPrisTier, users: number): TeamPrisOption {
  const billedSeats = Math.max(users, includedSeatsForTier(tier));
  const monthlyTotal = totalPriceForTierSeats(tier, "monthly", billedSeats);
  const yearlyTotal = totalPriceForTierSeats(tier, "yearly", billedSeats);
  return {
    tier,
    name: planNameForTier(tier),
    available: users <= MAX_SEATS[tier],
    billedSeats,
    monthlyTotal,
    yearlyTotal,
    yearlyPerMonth: Math.round(yearlyTotal / 12),
    perUserMonthly: Math.round(monthlyTotal / users),
  };
}

/**
 * Prisoverslag for et team på `users` brugere. Bygger på samme prisfunktion
 * som onboarding og Alunta-fakturering (totalPriceForTierSeats), så tallet på
 * marketingsiden ikke kan drive fra det kunden faktisk betaler.
 *
 * `needsHr` = behov for ferie, fravær, flex og godkendelser, som kun findes i
 * Virksomhed.
 */
export function estimateTeamPrice(
  users: number,
  needsHr = false,
): TeamPrisEstimate {
  // Et tømt eller ugyldigt talfelt giver NaN; regn så med 1 bruger.
  const n = Number.isFinite(users) ? Math.max(1, Math.floor(users)) : 1;
  const options = (["free", "team", "business"] as const).map((tier) =>
    option(tier, n),
  );
  const available = (tier: TeamPrisTier) =>
    options.find((o) => o.tier === tier)?.available ?? false;

  let recommended: TeamPrisTier | null = null;
  if (needsHr) {
    recommended = available("business") ? "business" : null;
  } else if (available("team")) {
    recommended = "team";
  } else if (available("business")) {
    recommended = "business";
  }

  return { users: n, options, recommended };
}
