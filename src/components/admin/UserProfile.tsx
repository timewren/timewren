"use client";

import { Copy } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

interface UserProfileProps {
  userId: string;
  activeTab: string;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 py-1.5 text-sm">
      <span className="w-40 shrink-0 text-gray-500">{label}</span>
      <span className="flex-1 text-gray-900">{children}</span>
    </div>
  );
}

function Dash() {
  return <span className="text-gray-400">—</span>;
}

function Bool({
  value,
  yes,
  no,
}: {
  value: boolean | null | undefined;
  yes?: string;
  no?: string;
}) {
  const t = useTranslations("adminUsers");
  if (value === null || value === undefined) return <Dash />;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        value ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
      }`}
    >
      {value ? (yes ?? t("profile.yes")) : (no ?? t("profile.no"))}
    </span>
  );
}

function CopyText({ value }: { value: string | null | undefined }) {
  const t = useTranslations("adminUsers");
  if (!value) return <Dash />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-gray-900">{value}</span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(value);
          toast.success(t("profile.copied"));
        }}
        className="text-gray-400 hover:text-gray-600"
        title={t("profile.copy")}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function formatDateTime(
  date: Date | string | null | undefined,
  locale: string,
): string {
  if (!date) return "—";
  return new Date(date).toLocaleString(toIntlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="px-4 py-3 divide-y divide-gray-50">{children}</div>
    </div>
  );
}

export function UserProfile({ userId, activeTab }: UserProfileProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const formatDate = (date: Date | string | null | undefined) =>
    formatDateTime(date, locale);
  const { data, isLoading } = trpc.admin.getUserAdminProfile.useQuery(
    { userId },
    { enabled: activeTab === "profile" },
  );

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500">
        {t("profile.noData")}
      </div>
    );
  }

  const { user, companyProfile, onboarding, emailPreferences, subscription } =
    data;

  const approvalWorkflowLabels: Record<string, string> = {
    off: t("profile.approvalOff"),
    per_entry: t("profile.approvalPerEntry"),
    per_period: t("profile.approvalPerPeriod"),
    per_invoice_draft: t("profile.approvalPerInvoiceDraft"),
  };

  return (
    <div className="space-y-4">
      <Section title={t("profile.sectionIdentity")}>
        <Row label={t("profile.name")}>{user.name}</Row>
        <Row label={t("profile.email")}>
          <CopyText value={user.email} />
        </Row>
        <Row label={t("profile.emailVerified")}>
          <Bool value={user.emailVerified} />
        </Row>
        <Row label={t("profile.phone")}>
          {user.phoneNumber ? <CopyText value={user.phoneNumber} /> : <Dash />}
        </Row>
        <Row label={t("profile.phoneVerified")}>
          <Bool value={user.phoneNumberVerified} />
        </Row>
        <Row label={t("profile.role")}>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {user.role ?? "user"}
          </span>
        </Row>
        <Row label={t("profile.userId")}>
          <CopyText value={user.id} />
        </Row>
        <Row label={t("profile.created")}>{formatDate(user.createdAt)}</Row>
        <Row label={t("profile.updated")}>{formatDate(user.updatedAt)}</Row>
      </Section>

      <Section title={t("profile.sectionStatus")}>
        <Row label={t("profile.onboarding")}>
          <Bool
            value={user.onboardingCompleted}
            yes={t("profile.onboardingDone")}
            no={t("profile.onboardingNotDone")}
          />
        </Row>
        {onboarding && (
          <>
            <Row label={t("profile.currentStep")}>
              {onboarding.currentStep ?? <Dash />}
            </Row>
            <Row label={t("profile.completedSteps")}>
              {onboarding.completedSteps &&
              onboarding.completedSteps.length > 0 ? (
                onboarding.completedSteps.join(", ")
              ) : (
                <Dash />
              )}
            </Row>
            <Row label={t("profile.importSource")}>
              {onboarding.importSource ?? <Dash />}
            </Row>
          </>
        )}
        <Row label={t("profile.twoFactor")}>
          <Bool value={user.twoFactorEnabled} />
        </Row>
        <Row label={t("profile.flagged")}>
          <Bool
            value={user.isFlagged}
            yes={t("profile.yes")}
            no={t("profile.no")}
          />
        </Row>
        {user.isFlagged && (
          <>
            <Row label={t("profile.flagReason")}>
              {user.flaggedReason ?? <Dash />}
            </Row>
            <Row label={t("profile.flaggedAt")}>
              {formatDate(user.flaggedAt)}
            </Row>
          </>
        )}
      </Section>

      <Section title={t("profile.sectionSubscription")}>
        {subscription ? (
          <>
            <Row label={t("profile.sectionStatus")}>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {subscription.status}
              </span>
            </Row>
            <Row label={t("profile.billingCycle")}>
              {subscription.billingCycle ?? <Dash />}
            </Row>
            <Row label={t("profile.trialEnds")}>
              {formatDate(subscription.trialEndsAt)}
            </Row>
            <Row label={t("profile.foundingTier")}>
              {subscription.foundingTier ?? <Dash />}
            </Row>
            <Row label={t("profile.discount")}>
              {subscription.discountPercent ? (
                t("profile.discountUntil", {
                  percent: subscription.discountPercent,
                  date: formatDate(subscription.discountExpiresAt),
                })
              ) : (
                <Dash />
              )}
            </Row>
            <Row label={t("profile.promoCode")}>
              {subscription.promoCode ?? <Dash />}
            </Row>
            <Row label={t("profile.aluntaId")}>
              <CopyText value={subscription.aluntaCustomerId} />
            </Row>
            <Row label={t("profile.stripeId")}>
              <CopyText value={subscription.stripeCustomerId} />
            </Row>
          </>
        ) : (
          <Row label={t("profile.noSubscription")}>
            <Dash />
          </Row>
        )}
      </Section>

      <Section title={t("profile.sectionPrefs")}>
        <Row label={t("profile.locale")}>{user.locale ?? <Dash />}</Row>
        <Row label={t("profile.timezone")}>{user.timezone ?? <Dash />}</Row>
        <Row label={t("profile.theme")}>{user.theme ?? <Dash />}</Row>
        <Row label={t("profile.weeklyGoal")}>
          {user.weeklyHourGoal ? (
            t("profile.hoursPerWeek", { hours: user.weeklyHourGoal })
          ) : (
            <Dash />
          )}
        </Row>
        <Row label={t("profile.workingHours")}>
          {user.workingHoursStart && user.workingHoursEnd ? (
            `${user.workingHoursStart} – ${user.workingHoursEnd}`
          ) : (
            <Dash />
          )}
        </Row>
        <Row label={t("profile.workingDays")}>
          {user.workingDays && user.workingDays.length > 0 ? (
            user.workingDays
              .map(
                (d: string) =>
                  [
                    "",
                    t("profile.day1"),
                    t("profile.day2"),
                    t("profile.day3"),
                    t("profile.day4"),
                    t("profile.day5"),
                    t("profile.day6"),
                    t("profile.day7"),
                  ][Number(d)],
              )
              .join(", ")
          ) : (
            <Dash />
          )}
        </Row>
        <Row label={t("profile.approvalWorkflow")}>
          {approvalWorkflowLabels[user.approvalWorkflow ?? "off"] ??
            user.approvalWorkflow}
        </Row>
        <Row label={t("profile.aiAutonomy")}>
          {user.aiAutonomyLevel ?? <Dash />}
        </Row>
        <Row label={t("profile.aiEmail")}>
          <Bool value={user.aiEmailProcessing} />
        </Row>
        <Row label={t("profile.prepaidAlert")}>
          {user.prepaidAlertRecipient ?? <Dash />}
        </Row>
      </Section>

      {companyProfile && (
        <Section title={t("profile.sectionCompany")}>
          <Row label={t("profile.company")}>{companyProfile.name}</Row>
          <Row label={t("profile.cvr")}>
            {companyProfile.cvrNumber ?? <Dash />}
          </Row>
          <Row label={t("profile.email")}>
            <CopyText value={companyProfile.email} />
          </Row>
          <Row label={t("profile.phone")}>
            {companyProfile.phone ?? <Dash />}
          </Row>
          <Row label={t("profile.address")}>
            {companyProfile.address ? (
              `${companyProfile.address}, ${companyProfile.postalCode ?? ""} ${companyProfile.city ?? ""}`
            ) : (
              <Dash />
            )}
          </Row>
          <Row label={t("profile.country")}>
            {companyProfile.country ?? <Dash />}
          </Row>
          <Row label={t("profile.vatRegistered")}>
            <Bool value={companyProfile.vatRegistered} />
            {companyProfile.vatNumber && (
              <span className="ml-2 text-xs text-gray-500">
                ({companyProfile.vatNumber})
              </span>
            )}
          </Row>
        </Section>
      )}

      {(user.attrSource || user.attrReferrer) && (
        <Section title={t("profile.sectionAttribution")}>
          <Row label={t("profile.attrSource")}>
            {user.attrSource ? (
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                {user.attrSource}
              </span>
            ) : (
              <Dash />
            )}
          </Row>
          <Row label={t("profile.attrMedium")}>
            {user.attrMedium ?? <Dash />}
          </Row>
          <Row label={t("profile.attrCampaign")}>
            {user.attrCampaign ?? <Dash />}
          </Row>
          <Row label={t("profile.attrReferrer")}>
            {user.attrReferrer ? (
              <span className="font-mono text-xs">{user.attrReferrer}</span>
            ) : (
              <Dash />
            )}
          </Row>
          <Row label={t("profile.attrLanding")}>
            {user.attrLandingPage ? (
              <span className="font-mono text-xs">{user.attrLandingPage}</span>
            ) : (
              <Dash />
            )}
          </Row>
        </Section>
      )}

      {emailPreferences && (
        <Section title={t("profile.sectionEmailPrefs")}>
          <Row label={t("profile.weeklyReport")}>
            <Bool
              value={emailPreferences.weeklyReport}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
          <Row label={t("profile.monthlyReport")}>
            <Bool
              value={emailPreferences.monthlyReport}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
          <Row label={t("profile.unbilledReminder")}>
            <Bool
              value={emailPreferences.unbilledReminder}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
          <Row label={t("profile.newLoginAlert")}>
            <Bool
              value={emailPreferences.newLoginAlert}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
          <Row label={t("profile.passwordChanged")}>
            <Bool
              value={emailPreferences.passwordChanged}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
          <Row label={t("profile.productUpdates")}>
            <Bool
              value={emailPreferences.productUpdates}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
          <Row label={t("profile.tips")}>
            <Bool
              value={emailPreferences.tipsAndTricks}
              yes={t("profile.on")}
              no={t("profile.off")}
            />
          </Row>
        </Section>
      )}
    </div>
  );
}
