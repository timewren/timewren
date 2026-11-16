"use client";

import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DemoDataBanner } from "@/components/dashboard/DemoDataBanner";
import { TrialActivationBanner } from "@/components/dashboard/TrialActivationBanner";
import { HomePrompt } from "@/components/home/HomePrompt";
import { HomeQuickStart } from "@/components/home/HomeQuickStart";
import { HomeSignals } from "@/components/home/HomeSignals";
import { HomeToday } from "@/components/home/HomeToday";
import { HomeWelcome, WELCOME_BANNER_KEY } from "@/components/home/HomeWelcome";
import { greetingKey } from "@/components/home/home-logic";
import { useEnterpriseLandingRedirect } from "@/hooks/useEnterpriseLandingRedirect";
import { useModules } from "@/hooks/useModules";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useSession } from "@/lib/auth-client";
import { welcomeCardState } from "@/lib/onboarding/activation";
import { trpc } from "@/providers/trpc-provider";

/**
 * Hjem — landingssiden efter login. Den hurtigste vej til at få tid ind:
 * prompt-feltet (skriv/indtal), hurtigstart af timeren og dagens poster.
 * Widget-dashboardet bor nu på /dashboard/overblik.
 * Research: docs/research/2026-10-02-hjem-dashboard.md
 */
export default function HomePage() {
  const t = useTranslations("home");
  const { data: session } = useSession();
  const { isEnabled, isPlaceholder } = useModules();
  const { hold } = useEnterpriseLandingRedirect();
  const { canManage, isResolved: roleResolved } = useOrgRole();

  // Velkomstkort + spørgsmål (#91): vises først når status og lukninger er
  // hentet, så det ikke blinker frem for brugere der allerede har lukket det.
  const { data: activation } = trpc.onboarding.activationStatus.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const { data: dismissedBanners } = trpc.user.getDismissedBanners.useQuery(
    undefined,
    { staleTime: 5 * 60 * 1000 },
  );
  const createdAt = session?.user?.createdAt;
  const welcome =
    activation && dismissedBanners
      ? welcomeCardState({
          hasTimeEntry: activation.hasTimeEntry,
          primaryUse: activation.primaryUse,
          dismissed: dismissedBanners.includes(WELCOME_BANNER_KEY),
          accountAgeDays: createdAt
            ? (Date.now() - new Date(createdAt).getTime()) / 86_400_000
            : null,
        })
      : null;

  // Hilsen beregnes først i browseren (brugerens ur) — undgår hydration-skift
  const [greeting, setGreeting] = useState<string | null>(null);
  useEffect(() => {
    setGreeting(t(`greeting.${greetingKey(new Date().getHours())}`));
  }, [t]);

  if (hold) return null;

  const showClients = !isPlaceholder && isEnabled("clients");
  const showProjects = !isPlaceholder && isEnabled("projects");
  const showKlippekort = !isPlaceholder && isEnabled("klippekort");
  const showInvoicing = !isPlaceholder && isEnabled("invoicing");
  const firstName = session?.user?.name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <DemoDataBanner />
      <TrialActivationBanner hideChecklist={!!welcome?.visible} />

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {greeting
            ? `${greeting}${firstName ? `, ${firstName}` : ""}`
            : t("page.title")}
        </h1>
        <Link
          href="/dashboard/overblik"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          data-tour="hjem-overblik-link"
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
          {t("page.overview")}
        </Link>
      </header>

      {welcome?.visible && activation && (
        <HomeWelcome
          showFirstTimer={welcome.showFirstTimer}
          showSurvey={welcome.showSurvey}
          primaryUse={activation.primaryUse}
        />
      )}

      <HomePrompt
        showClients={showClients}
        showProjects={showProjects}
        showKlippekort={showKlippekort}
      />

      {/* grid-cols-1 = minmax(0,1fr): ellers strækker lange beskrivelser (truncate)
          kolonnen ud over skærmen på mobil/tablet */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Mobil: hurtigstart før dagens poster; desktop: i højre kolonne */}
        <div className="min-w-0 space-y-4 lg:col-start-3 lg:row-start-1">
          <HomeQuickStart showProjects={showProjects} />
          <HomeSignals
            showKlippekort={showKlippekort}
            showInvoicing={showInvoicing}
            showClients={showClients}
            canManageTeam={roleResolved && canManage}
          />
        </div>
        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1">
          <HomeToday />
        </div>
      </div>
    </div>
  );
}
