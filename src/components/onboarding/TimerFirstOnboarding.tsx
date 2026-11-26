"use client";

import { useSearchParams } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { TimewrenBillingPanel } from "@/components/subscription/TimewrenBillingPanel";
import { ErrorState } from "@/components/ui/ErrorState";
import { Modal } from "@/components/ui/Modal";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
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
 * TimeWren Cloud (Stripe): en ejer på Gratis ser planerne i EUR, før
 * onboardingen afsluttes, og vælger en betalt plan (Stripe Checkout) eller
 * fortsætter på Gratis.
 *
 * Fejler opstarten, vises den gamle wizard som sikkerhedsnet, så ingen
 * bruger kan ende uden abonnement eller fast i en halv tilstand.
 */
export function TimerFirstOnboarding({
  loadingFallback,
}: {
  loadingFallback?: ReactNode;
}) {
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  // Org-bevidst opslag: en inviteret admin i en org med abonnement må ikke
  // få en ekstra prøve oven i org'ens (#91-review)
  const subscriptionQuery = trpc.subscription.getDetails.useQuery();
  const roleQuery = trpc.organization.getMyRole.useQuery();
  const planOptionsQuery = trpc.onboarding.planOptions.useQuery();
  const { data: subscription, isSuccess: subscriptionLoaded } =
    subscriptionQuery;
  const { data: myRole, isSuccess: roleLoaded } = roleQuery;
  const { data: planOptions, isSuccess: planOptionsLoaded } = planOptionsQuery;

  // TimeWren Cloud (Stripe): ejeren ser planerne i EUR, før onboardingen
  // afsluttes, og vælger en betalt plan eller fortsætter på Gratis.
  const { enabled, provider, isLoading: billingLoading } = useBillingEnabled();
  const stripePlans = enabled && provider === "stripe";
  const [showPlans, setShowPlans] = useState(false);

  const createSubscription = trpc.onboarding.createSubscription.useMutation();
  const complete = trpc.onboarding.complete.useMutation();
  const dismissBanner = trpc.user.dismissBanner.useMutation();

  const ready =
    subscriptionLoaded && roleLoaded && planOptionsLoaded && !billingLoading;

  // Afslut onboardingen. `refresh: false` lige før skiftet til Stripe
  // Checkout: siden forlades alligevel, og profilen hentes igen ved
  // tilbagekomst. Først efter et oprettet checkout eller et valg af Gratis;
  // fejler checkout, står plantrinnet der stadig efter en genindlæsning.
  const finish = useCallback(
    async ({ refresh }: { refresh: boolean }) => {
      await complete.mutateAsync();
      // Rundvisningen af ejer-funktionerne springes over: Hjem og
      // velkomstkortet er første skridt. Den kan startes fra brugermenuen.
      // Gemmes før profilen hentes igen, så turen ikke når at starte.
      await dismissBanner
        .mutateAsync({ key: "guided-tour" })
        .catch(() => undefined);
      if (!refresh) return;
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
    },
    [complete, dismissBanner, utils],
  );

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
        // TimeWren-ejer på Gratis (ny eller på vej tilbage): planerne først.
        if (
          stripePlans &&
          !isOrgMember &&
          (!subscription || subscription.isFree)
        ) {
          setShowPlans(true);
          return;
        }
        await finish({ refresh: true });
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
    stripePlans,
    finish,
  ]);

  const continueFree = () => {
    finish({ refresh: true })
      .then(() => setShowPlans(false))
      .catch((error) => {
        console.error("Timer-first onboarding fejlede:", error);
        setFailed(true);
      });
  };

  if (failed) return <OnboardingModal />;
  if (showPlans) {
    return (
      <Modal
        isOpen
        onClose={continueFree}
        size="full"
        closeOnOverlayClick={false}
      >
        <TimewrenBillingPanel
          afterCheckoutCreated={() => finish({ refresh: false })}
          onContinueFree={continueFree}
        />
      </Modal>
    );
  }
  const failedQueries = [subscriptionQuery, roleQuery, planOptionsQuery].filter(
    (query) => query.isError,
  );
  if (failedQueries.length > 0) {
    return (
      <div
        className={
          loadingFallback ? "grid min-h-screen place-items-center p-4" : "p-4"
        }
      >
        <ErrorState
          isRetrying={failedQueries.some((query) => query.isFetching)}
          onRetry={() => {
            for (const query of failedQueries) void query.refetch();
          }}
        />
      </div>
    );
  }
  return loadingFallback ?? null;
}
