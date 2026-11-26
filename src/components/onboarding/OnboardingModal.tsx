"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CompanyInfoStep } from "@/components/onboarding/CompanyInfoStep";
import { CompleteStep } from "@/components/onboarding/CompleteStep";
import { DataImportStep } from "@/components/onboarding/DataImportStep";
import { FirstClientStep } from "@/components/onboarding/FirstClientStep";
import { SubscriptionStep } from "@/components/onboarding/SubscriptionStep";
import { TimewrenBillingPanel } from "@/components/subscription/TimewrenBillingPanel";
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { useSession } from "@/lib/auth-client";
import {
  type OnboardingPlanTier,
  resolveSignupPlanTier,
} from "@/lib/billing/signup-plan";
import { trpc } from "@/providers/trpc-provider";

type OnboardingStep =
  | "subscription"
  | "company_info"
  | "data_import"
  | "first_client"
  | "ai_setup"
  | "payment"
  | "complete";

// Trin der er fjernet fra wizard'en: betalingen bor nu på dashboardets
// trial-banner (efter brugeren har set værdi), og AI-opsætning ligger under
// Indstillinger → AI. Gamle in-flight forløb og redirects på de trin sendes
// videre til "complete" i stedet for at ende på et trin der ikke renderes.
const REMOVED_STEPS: OnboardingStep[] = ["ai_setup", "payment"];
const normalizeStep = (s: OnboardingStep): OnboardingStep =>
  REMOVED_STEPS.includes(s) ? "complete" : s;

interface OnboardingData {
  subscription?: {
    billingCycle: "monthly" | "yearly";
    planTier?: OnboardingPlanTier;
    seatCount?: number;
    isEffihubMigrant: boolean;
    promoCode?: string;
    trialEndsAt?: Date;
  };
  companyInfo?: {
    name: string;
    cvrNumber?: string;
    email: string;
    phone?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    country: string;
    bankRegNr?: string;
    bankAccountNr?: string;
    vatRegistered?: boolean;
    vatRegisteredChosen?: boolean;
    vatNumber?: string;
  };
  import?: {
    importSource: "effihub" | "demo" | "manual";
    clientsImported?: number;
    projectsImported?: number;
  };
  firstClient?: {
    clientName?: string;
    clientEmail?: string;
    projectName?: string;
    hourlyRate?: string;
  };
  aiSetup?: {
    aiAutonomyLevel: string;
    emailEnabled: boolean;
    calendarConnected: boolean;
  };
}

export function OnboardingModal() {
  const t = useTranslations("onboarding.modal");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [step, setStep] = useState<OnboardingStep>("subscription");
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({});

  // Get tRPC utils for cache invalidation
  const utils = trpc.useUtils();

  // Fetch existing progress
  const { data: progress } = trpc.onboarding.getProgress.useQuery();
  const { data: userProfile } = trpc.user.getProfile.useQuery();
  const { data: existingSubscription } =
    trpc.onboarding.getSubscription.useQuery();
  const { data: existingCompanyProfile } =
    trpc.onboarding.getCompanyProfile.useQuery();
  // Plain org members get a reduced flow (#172): subscription and company
  // info are the org's — a member hitting those steps would either create a
  // stray per-user subscription or get FORBIDDEN on saveCompanyProfile.
  const { data: myRole } = trpc.organization.getMyRole.useQuery();
  const isOrgMember = !!myRole && !myRole.isSolo && !myRole.canManage;

  // Forvalgt plan ud fra hvor brugeren kom fra: ?plan= fra prissiden eller
  // ?ref=segment-* fra segmentsiderne (bæres gennem /register → /dashboard).
  // Privat forvælges kun når planen kan købes — ellers standard (solo).
  const { data: planOptions, isLoading: planOptionsLoading } =
    trpc.onboarding.planOptions.useQuery();
  const privatAvailable = planOptions?.privatAvailable ?? false;
  const signupPlanTier = resolveSignupPlanTier({
    plan: searchParams.get("plan"),
    ref: searchParams.get("ref"),
  });
  const preferredPlanTier =
    signupPlanTier === "privat" && !privatAvailable
      ? undefined
      : signupPlanTier;

  // Plan-trinnet kun når der kan betales: selvhost uden udbyder og TimeWren
  // (betaling kommer senere) får den stille standardrække i stedet.
  const {
    enabled: billingProviderEnabled,
    checkoutAvailable,
    provider,
    isLoading: billingLoading,
  } = useBillingEnabled();
  // TimeWren Cloud (Stripe): planerne i EUR (TimewrenBillingPanel) i stedet
  // for Alunta-plantrinnet, som på /dashboard/onboarding.
  const stripePlanStep = billingProviderEnabled && provider === "stripe";
  const billingEnabled =
    billingProviderEnabled && checkoutAvailable && !stripePlanStep;
  // Mutations
  const createSubscriptionMutation =
    trpc.onboarding.createSubscription.useMutation();
  const saveCompanyProfileMutation =
    trpc.onboarding.saveCompanyProfile.useMutation();
  const updateImportInfoMutation =
    trpc.onboarding.updateImportInfo.useMutation();
  const seedDemoDataMutation = trpc.onboarding.seedDemoData.useMutation();
  const createClientMutation = trpc.clients.create.useMutation();
  const createProjectMutation = trpc.projects.create.useMutation();
  const completeOnboardingMutation = trpc.onboarding.complete.useMutation();
  const updateStepMutation = trpc.onboarding.updateStep.useMutation();

  // Helper to change step and persist it
  const goToStep = (newStep: OnboardingStep) => {
    setStep(newStep);
    updateStepMutation.mutate({ step: newStep });
  };

  // Check for step query parameter (e.g., from Effihub import redirect)
  // biome-ignore lint/correctness/useExhaustiveDependencies: trinnet læses kun fra URL'en; sprogskift må ikke nulstille det, så t står ikke i deps
  useEffect(() => {
    const stepParam = searchParams.get("step");
    if (stepParam) {
      const validSteps: OnboardingStep[] = [
        "subscription",
        "company_info",
        "data_import",
        "first_client",
        "ai_setup",
        "payment",
        "complete",
      ];

      // Handle payment success redirect from Stripe
      const paymentParam = searchParams.get("payment");
      if (paymentParam === "success" && stepParam === "complete") {
        toast.success(t("paymentAdded"));
      }
      if (validSteps.includes(stepParam as OnboardingStep)) {
        setStep(normalizeStep(stepParam as OnboardingStep));
      }
    }
  }, [searchParams]);

  // Restore progress on load
  useEffect(() => {
    if (progress && !progress.isCompleted) {
      const currentStep = progress.currentStep as OnboardingStep;
      if (currentStep) {
        setStep(normalizeStep(currentStep));
      }

      // Restore subscription data
      if (existingSubscription) {
        setOnboardingData((prev) => ({
          ...prev,
          subscription: {
            billingCycle: existingSubscription.billingCycle as
              | "monthly"
              | "yearly",
            planTier: (existingSubscription.planTier ??
              "solo") as OnboardingPlanTier,
            seatCount: existingSubscription.seatCount,
            isEffihubMigrant: !!existingSubscription.promoCode,
            promoCode: existingSubscription.promoCode || undefined,
            trialEndsAt: existingSubscription.trialEndsAt,
          },
        }));
      }

      // Restore company info
      if (existingCompanyProfile) {
        setOnboardingData((prev) => ({
          ...prev,
          companyInfo: {
            name: existingCompanyProfile.name,
            cvrNumber: existingCompanyProfile.cvrNumber || undefined,
            email: existingCompanyProfile.email,
            phone: existingCompanyProfile.phone || undefined,
            address: existingCompanyProfile.address || undefined,
            postalCode: existingCompanyProfile.postalCode || undefined,
            city: existingCompanyProfile.city || undefined,
            country: existingCompanyProfile.country || "Danmark",
            bankRegNr: existingCompanyProfile.bankRegNr || undefined,
            bankAccountNr: existingCompanyProfile.bankAccountNr || undefined,
            vatRegistered: existingCompanyProfile.vatRegistered || false,
            vatRegisteredChosen: existingCompanyProfile.vatRegisteredChosen,
            vatNumber: existingCompanyProfile.vatNumber || undefined,
          },
        }));
      }
    }
  }, [progress, existingSubscription, existingCompanyProfile]);

  // Prevent scrolling when modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  // Handlers
  const handleSubscriptionNext = async (data: {
    billingCycle: "monthly" | "yearly";
    planTier: OnboardingPlanTier;
    seatCount: number;
    isEffihubMigrant: boolean;
    promoCode?: string;
  }) => {
    try {
      const result = await createSubscriptionMutation.mutateAsync({
        billingCycle: data.billingCycle,
        planTier: data.planTier,
        seatCount: data.seatCount,
        isEffihubMigrant: data.isEffihubMigrant,
        promoCode: data.promoCode,
      });

      setOnboardingData((prev) => ({
        ...prev,
        subscription: {
          ...data,
          trialEndsAt: result.trialEndsAt,
        },
      }));

      goToStep("company_info");
      toast.success(t("subscriptionChosen"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("subscriptionFailed"),
      );
    }
  };

  const handleCompanyInfoNext = async (data: OnboardingData["companyInfo"]) => {
    if (!data) return;

    try {
      const saved = await saveCompanyProfileMutation.mutateAsync(data);

      setOnboardingData((prev) => ({
        ...prev,
        // Momsfluebenet som serveren gemte det (CVR-reglen), så et skridt
        // tilbage viser det samme og husker, om brugeren selv valgte
        companyInfo: {
          ...data,
          vatRegistered: saved.vatRegistered ?? false,
          vatRegisteredChosen: saved.vatRegisteredChosen,
        },
      }));

      goToStep("data_import");
      toast.success(t("companySaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("companyFailed"));
    }
  };

  const handleDataImportNext = async (data: {
    importSource: "effihub" | "demo" | "manual";
    skipToComplete: boolean;
  }) => {
    setOnboardingData((prev) => ({
      ...prev,
      import: {
        importSource: data.importSource,
      },
    }));

    if (data.importSource === "demo") {
      // Demo-eksempeldata (#86): seed og hop direkte til complete —
      // first_client-trinnet er overflødigt når kontoen har indhold.
      try {
        await seedDemoDataMutation.mutateAsync();
        await updateImportInfoMutation.mutateAsync({
          importSource: "demo",
          clientsImported: 3,
          projectsImported: 2,
          timeEntriesImported: 11,
          prepaidPackagesImported: 1,
        });
        toast.success(t("demoCreated"));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t("demoFailed"));
        return;
      }
      goToStep("complete");
      return;
    }

    if (data.importSource === "manual") {
      goToStep("first_client");
    } else {
      // Effihub import will redirect; afslut wizard'en bagefter
      goToStep("complete");
    }
  };

  const handleFirstClientNext = async (data: {
    createClient: boolean;
    clientName?: string;
    clientEmail?: string;
    projectName?: string;
    hourlyRate?: string;
  }) => {
    if (!data.createClient || !data.clientName || !data.projectName) {
      goToStep("complete");
      return;
    }

    try {
      // Create client
      const client = await createClientMutation.mutateAsync({
        name: data.clientName,
        email: data.clientEmail,
        defaultHourlyRate: data.hourlyRate,
      });

      // Create project
      await createProjectMutation.mutateAsync({
        name: data.projectName,
        clientId: client.id,
        hourlyRate: data.hourlyRate,
      });

      setOnboardingData((prev) => ({
        ...prev,
        firstClient: data,
      }));

      // Update import info to mark manual setup complete
      await updateImportInfoMutation.mutateAsync({
        importSource: "manual",
        clientsImported: 1,
        projectsImported: 1,
      });

      goToStep("complete");
      toast.success(t("clientCreated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("clientFailed"));
    }
  };

  const handleFirstClientSkip = async () => {
    try {
      // Update import info to mark manual setup (but with 0 imports)
      await updateImportInfoMutation.mutateAsync({
        importSource: "manual",
        clientsImported: 0,
        projectsImported: 0,
      });

      goToStep("complete");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("continueFailed"));
    }
  };

  const handleFinish = async () => {
    try {
      await completeOnboardingMutation.mutateAsync();

      await utils.subscription.getDetails.invalidate();
      // Invalidate the user profile cache so dashboard won't show modal again
      await utils.user.getProfile.invalidate();
      await utils.onboarding.getProgress.invalidate();

      toast.success(t("finished"));

      router.push("/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finishFailed"));
    }
  };

  // Uden betalingsudbyder (selvhost) er der ingen plan at vælge: opret den
  // stille standardrække og gå videre til virksomhedsoplysninger (#962).
  // TimeWren-konti får Gratis af serveren (onboarding.createSubscription).
  const skipSubscriptionRef = useRef(false);
  useEffect(() => {
    if (
      billingLoading ||
      billingEnabled ||
      stripePlanStep ||
      step !== "subscription"
    )
      return;
    if (isOrgMember) return;
    if (skipSubscriptionRef.current) return;
    skipSubscriptionRef.current = true;
    createSubscriptionMutation
      .mutateAsync({
        billingCycle: "monthly",
        planTier: "solo",
        isEffihubMigrant: false,
      })
      .catch(() => undefined)
      .finally(() => goToStep("company_info"));
  });

  // Progress bar
  const steps = [
    ...(billingEnabled || stripePlanStep
      ? [{ id: "subscription", label: t("step.subscription") }]
      : []),
    { id: "company_info", label: t("step.company_info") },
    { id: "data_import", label: t("step.data_import") },
    { id: "first_client", label: t("step.first_client") },
    { id: "complete", label: t("step.complete") },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  // Reduced flow for plain org members: their org already owns subscription
  // and company info, so the wizard collapses to a welcome + finish.
  if (isOrgMember) {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto">
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-[3px]" />
        <div className="relative flex min-h-screen items-center justify-center p-4">
          <div className="relative w-full max-w-lg rounded-lg border border-gray-200 bg-white p-6 sm:p-8 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-900">
              {t("member.title")}
            </h2>
            <p className="mt-3 text-gray-600">{t("member.intro")}</p>
            <ul className="mt-4 space-y-2 text-sm text-gray-600">
              <li>{t("member.item1")}</li>
              <li>{t("member.item2")}</li>
              <li>{t("member.item3")}</li>
            </ul>
            <button
              type="button"
              onClick={handleFinish}
              disabled={completeOnboardingMutation.isPending}
              className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {completeOnboardingMutation.isPending
                ? t("member.working")
                : t("member.go")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      {/* Backdrop with blur effect */}
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-[3px]" />

      {/* Modal Content */}
      <div className="relative flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-4xl">
          {/* Progress Bar */}
          <div className="mb-4 sm:mb-6 rounded-lg bg-white/95 p-3 sm:p-6 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between">
              {steps.map((s, index) => (
                <div key={s.id} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-full border-2 text-xs sm:text-sm font-semibold transition-colors ${
                        index <= currentStepIndex
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-gray-300 bg-white text-gray-400"
                      }`}
                    >
                      {index + 1}
                    </div>
                    <p
                      className={`mt-2 hidden text-xs font-medium sm:block ${
                        index <= currentStepIndex
                          ? "text-brand-600"
                          : "text-gray-500"
                      }`}
                    >
                      {s.label}
                    </p>
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`mx-2 h-0.5 flex-1 transition-colors ${
                        index < currentStepIndex
                          ? "bg-brand-600"
                          : "bg-gray-300"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step Content */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 sm:p-8 shadow-2xl">
            {/* Vent på planOptions før Privat-forvalg, da picker'en kun læser
                initialData ved mount. */}
            {step === "subscription" &&
              billingEnabled &&
              !(
                planOptionsLoading &&
                (signupPlanTier === "privat" ||
                  onboardingData.subscription?.planTier === "privat")
              ) && (
                <SubscriptionStep
                  onNext={handleSubscriptionNext}
                  privatAvailable={privatAvailable}
                  initialData={{
                    ...onboardingData.subscription,
                    planTier:
                      onboardingData.subscription?.planTier ??
                      preferredPlanTier,
                  }}
                />
              )}

            {/* TimeWren Cloud: serveren opretter Gratis-rækken; en betalt plan
                går via Stripe Checkout og kommer tilbage til næste trin. */}
            {step === "subscription" && stripePlanStep && (
              <TimewrenBillingPanel
                returnPath="/dashboard/onboarding?step=company_info"
                beforeCheckout={async () => {
                  await createSubscriptionMutation.mutateAsync({
                    billingCycle: "monthly",
                    planTier: "solo",
                    isEffihubMigrant: false,
                  });
                }}
                onContinueFree={() => {
                  createSubscriptionMutation
                    .mutateAsync({
                      billingCycle: "monthly",
                      planTier: "solo",
                      isEffihubMigrant: false,
                    })
                    .catch(() => undefined)
                    .finally(() => goToStep("company_info"));
                }}
              />
            )}

            {step === "company_info" && (
              <CompanyInfoStep
                onNext={handleCompanyInfoNext}
                onBack={() => goToStep("subscription")}
                onSkip={() => goToStep("data_import")}
                initialData={onboardingData.companyInfo}
                userEmail={session?.user.email}
              />
            )}

            {step === "data_import" && (
              <DataImportStep
                onNext={handleDataImportNext}
                onBack={() => goToStep("company_info")}
              />
            )}

            {step === "first_client" && (
              <FirstClientStep
                onNext={handleFirstClientNext}
                onSkip={handleFirstClientSkip}
                onBack={() => goToStep("data_import")}
                defaultHourlyRate={userProfile?.defaultHourlyRate || undefined}
              />
            )}

            {step === "complete" && (
              <CompleteStep
                onFinish={handleFinish}
                subscriptionData={onboardingData.subscription}
                companyData={onboardingData.companyInfo}
                importData={onboardingData.import}
                aiSetupData={onboardingData.aiSetup}
                hasPaymentMethod={searchParams.get("payment") === "success"}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
