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
import { useBillingEnabled } from "@/hooks/useBillingEnabled";
import { useSession } from "@/lib/auth-client";
import type { OnboardingPlanTier } from "@/lib/billing/signup-plan";
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
    vatRegistered: boolean;
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

export default function OnboardingPage() {
  const t = useTranslations("onboarding.modal");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [step, setStep] = useState<OnboardingStep>("subscription");
  const [onboardingData, setOnboardingData] = useState<OnboardingData>({});

  // Get tRPC utils for cache invalidation
  // Plan-trinnet kun når der kan betales: selvhost uden udbyder og TimeWren
  // (betaling kommer senere) får den stille standardrække i stedet.
  const {
    enabled: billingProviderEnabled,
    checkoutAvailable,
    isLoading: billingLoading,
  } = useBillingEnabled();
  const billingEnabled = billingProviderEnabled && checkoutAvailable;
  const utils = trpc.useUtils();

  // Fetch existing progress
  const { data: progress } = trpc.onboarding.getProgress.useQuery();
  const { data: userProfile } = trpc.user.getProfile.useQuery();
  const { data: existingSubscription } =
    trpc.onboarding.getSubscription.useQuery();
  const { data: existingCompanyProfile } =
    trpc.onboarding.getCompanyProfile.useQuery();

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

  // Redirect away if onboarding is already completed
  useEffect(() => {
    if (userProfile?.onboardingCompleted) {
      router.replace("/dashboard");
    }
  }, [userProfile, router]);

  // Check for step query parameter (e.g., from Effihub import redirect)
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
      // (Det tidligere payment=success-håndtag her var dødt — ingen flow
      // redirecter til denne side med payment=success. Subscribe-konverteringen
      // fyres fra settings/subscription-siden, hvor checkout reelt lander.)
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
            planTier:
              (existingSubscription.planTier as OnboardingPlanTier | null) ??
              "solo",
            seatCount: existingSubscription.seatCount ?? undefined,
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
            vatNumber: existingCompanyProfile.vatNumber || undefined,
          },
        }));
      }
    }
  }, [progress, existingSubscription, existingCompanyProfile]);

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
      await saveCompanyProfileMutation.mutateAsync(data);

      setOnboardingData((prev) => ({
        ...prev,
        companyInfo: data,
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
      // Demo-eksempeldata (#86): seed og spring first_client over.
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

      // Invalidate the user profile cache so dashboard won't redirect back
      await utils.user.getProfile.invalidate();
      await utils.onboarding.getProgress.invalidate();

      toast.success(t("finished"));

      // Use window.location for a full page reload to ensure fresh data
      window.location.href = "/dashboard";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finishFailed"));
    }
  };

  // Uden betalingsudbyder (selvhost) er der ingen plan at vælge: opret den
  // stille standardrække og gå videre til virksomhedsoplysninger (#962).
  // TimeWren-konti får Gratis af serveren (onboarding.createSubscription).
  const skipSubscriptionRef = useRef(false);
  useEffect(() => {
    if (billingLoading || billingEnabled || step !== "subscription") return;

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
    ...(billingEnabled
      ? [{ id: "subscription", label: t("step.subscription") }]
      : []),
    { id: "company_info", label: t("step.company_info") },
    { id: "data_import", label: t("step.data_import") },
    { id: "first_client", label: t("step.first_client") },
    { id: "complete", label: t("step.complete") },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="min-h-screen bg-tt-flade py-12">
      <div className="mx-auto max-w-4xl px-4">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((s, index) => (
              <div key={s.id} className="flex flex-1 items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors ${
                      index <= currentStepIndex
                        ? "border-brand-600 dark:border-brand-400 bg-tt-gran text-tt-paa-gran"
                        : "border-gray-300 bg-white text-gray-400"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <p
                    className={`mt-2 hidden text-xs font-medium sm:block ${
                      index <= currentStepIndex
                        ? "text-brand-600 dark:text-brand-400"
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
                        ? "bg-brand-600 dark:bg-brand-400"
                        : "bg-gray-300"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-8">
          {step === "subscription" && billingEnabled && (
            <SubscriptionStep
              onNext={handleSubscriptionNext}
              initialData={onboardingData.subscription}
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
  );
}
