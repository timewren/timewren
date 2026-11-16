"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { readCampaignCookie } from "@/lib/billing/campaign-codes";
import { resolveSignupPlanTier } from "@/lib/billing/signup-plan";
import { trpc } from "@/providers/trpc-provider";

/**
 * Timer-first-onboarding (#91/#173): ingen wizard i den kritiske vej.
 *
 * En ny bruger lander direkte på Hjem. Prøveperioden startes i baggrunden
 * på den plan brugeren kom fra (?plan= / ?ref=segment-*, ellers Selvstændig)
 * med en evt. kampagnekode fra link-cookien — præcis som wizard'ens
 * forvalg. Virksomhedsoplysninger spørges der først om, når de skal bruges
 * (første faktura); planen kan skiftes under Indstillinger → Abonnement.
 *
 * Fejler opstarten, vises den gamle wizard som sikkerhedsnet, så ingen
 * bruger kan ende uden abonnement eller fast i en halv tilstand.
 */
export function TimerFirstOnboarding() {
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  // Org-bevidst opslag: en inviteret admin i en org med abonnement må ikke
  // få en ekstra prøve oven i org'ens (#91-review)
  const { data: subscription, isSuccess: subscriptionLoaded } =
    trpc.subscription.getDetails.useQuery();
  const { data: myRole, isSuccess: roleLoaded } =
    trpc.organization.getMyRole.useQuery();
  const { data: planOptions, isSuccess: planOptionsLoaded } =
    trpc.onboarding.planOptions.useQuery();

  const createSubscription = trpc.onboarding.createSubscription.useMutation();
  const complete = trpc.onboarding.complete.useMutation();
  const dismissBanner = trpc.user.dismissBanner.useMutation();

  const ready = subscriptionLoaded && roleLoaded && planOptionsLoaded;

  useEffect(() => {
    if (!ready || startedRef.current) return;
    startedRef.current = true;

    // Almindelige org-medlemmer: organisationen ejer abonnementet (#172)
    const isOrgMember = !!myRole && !myRole.isSolo && !myRole.canManage;
    const signupTier = resolveSignupPlanTier({
      plan: searchParams.get("plan"),
      ref: searchParams.get("ref"),
    });
    const planTier =
      signupTier === "privat" && !planOptions?.privatAvailable
        ? "solo"
        : (signupTier ?? "solo");

    (async () => {
      try {
        if (!isOrgMember && !subscription) {
          await createSubscription.mutateAsync({
            billingCycle: "monthly",
            planTier,
            isEffihubMigrant: false,
            promoCode: readCampaignCookie() ?? undefined,
          });
        }
        await complete.mutateAsync();
        // Rundvisningen af ejer-funktionerne springes over: Hjem og
        // velkomstkortet er første skridt. Den kan startes fra brugermenuen.
        // Gemmes før profilen hentes igen, så turen ikke når at starte.
        await dismissBanner
          .mutateAsync({ key: "guided-tour" })
          .catch(() => undefined);
        // Abonnementet først: profilen afgør "needsOnboarding", og flipper den
        // før abonnementet er hentet, ville betalingsmuren blinke frem.
        await Promise.all([
          utils.onboarding.getSubscription.invalidate(),
          utils.subscription.getDetails.invalidate(),
        ]);
        await Promise.all([
          utils.user.getProfile.invalidate(),
          utils.onboarding.getProgress.invalidate(),
        ]);
      } catch (error) {
        console.error("Timer-first onboarding fejlede:", error);
        setFailed(true);
      }
    })();
  }, [
    ready,
    myRole,
    subscription,
    planOptions,
    searchParams,
    createSubscription,
    complete,
    dismissBanner,
    utils,
  ]);

  if (failed) return <OnboardingModal />;
  return null;
}
