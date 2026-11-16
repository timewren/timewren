import type { SegmentSlug } from "@/lib/marketing/segments";

/**
 * Tiers en ny bruger kan starte en prøveperiode på i onboardingen.
 * "free" er ikke et trial-valg — den lander man på, når en trial udløber.
 */
export type OnboardingPlanTier = "privat" | "solo" | "team" | "business";

const ONBOARDING_PLAN_TIERS: readonly OnboardingPlanTier[] = [
  "privat",
  "solo",
  "team",
  "business",
];

/**
 * Segmentsiderne (/privat, /selvstaendig, /teams-og-bureauer, /virksomheder)
 * linker til `/register?ref=segment-<slug>`. Hvert segment lander på sin plan
 * i prisstigen, så prøveperioden matcher der hvor brugeren kom fra.
 */
export const SEGMENT_PLAN_TIER: Record<SegmentSlug, OnboardingPlanTier> = {
  privat: "privat",
  selvstaendig: "solo",
  "teams-og-bureauer": "team",
  virksomheder: "business",
};

const SEGMENT_REF_PREFIX = "segment-";

export function isOnboardingPlanTier(
  value: string | null | undefined,
): value is OnboardingPlanTier {
  return (
    !!value && (ONBOARDING_PLAN_TIERS as readonly string[]).includes(value)
  );
}

/** `segment-virksomheder` → "business". Ukendte refs giver undefined. */
export function planTierFromSegmentRef(
  ref: string | null | undefined,
): OnboardingPlanTier | undefined {
  if (!ref?.startsWith(SEGMENT_REF_PREFIX)) return undefined;
  const slug = ref.slice(SEGMENT_REF_PREFIX.length);
  return Object.hasOwn(SEGMENT_PLAN_TIER, slug)
    ? SEGMENT_PLAN_TIER[slug as SegmentSlug]
    : undefined;
}

/**
 * Den plan onboardingen skal forvælge ud fra signup-linkets query-params.
 * Et eksplicit `?plan=` (fra /pricing) vinder over `?ref=segment-*`.
 * undefined betyder "ingen præference" — picker'en falder tilbage til solo.
 */
export function resolveSignupPlanTier(params: {
  plan?: string | null;
  ref?: string | null;
}): OnboardingPlanTier | undefined {
  if (isOnboardingPlanTier(params.plan)) return params.plan;
  return planTierFromSegmentRef(params.ref);
}
