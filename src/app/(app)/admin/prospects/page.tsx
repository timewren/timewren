"use client";

import {
  AlertTriangle,
  ArrowRight,
  Beaker,
  CalendarX,
  CheckCircle2,
  Clock,
  FlaskConical,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

type Tab = "trials" | "demos";

const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: "trials", label: "Trials", icon: Beaker },
  { key: "demos", label: "Demo-konti", icon: FlaskConical },
];

function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  return new Date(date).toLocaleString("da-DK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Stat({
  label,
  value,
  icon: Icon,
  color = "blue",
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: "blue" | "green" | "amber" | "red" | "gray";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${colors[color]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function UrgencyBadge({
  urgency,
  daysUntilEnd,
}: {
  urgency: "expired" | "urgent" | "soon" | "ok";
  daysUntilEnd: number | null;
}) {
  if (urgency === "expired") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        <AlertTriangle className="h-3 w-3" />
        Udløbet
      </span>
    );
  }
  if (urgency === "urgent") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        <Clock className="h-3 w-3" />
        {daysUntilEnd}d
      </span>
    );
  }
  if (urgency === "soon") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
        <Clock className="h-3 w-3" />
        {daysUntilEnd}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {daysUntilEnd !== null ? `${daysUntilEnd}d` : "—"}
    </span>
  );
}

function TrialsTab() {
  const { data, isLoading } = trpc.admin.prospects.listTrials.useQuery();

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }
  if (!data) return null;

  const committed = data.trials.filter((t) => t.committed);
  const floating = data.trials.filter((t) => !t.committed);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-5">
        <Stat
          label="Aktive trials"
          value={data.total}
          icon={Beaker}
          color="blue"
        />
        <Stat
          label="Med abonnement"
          value={data.committed}
          icon={CheckCircle2}
          color="green"
        />
        <Stat
          label="Uden abonnement"
          value={data.floating}
          icon={XCircle}
          color="amber"
        />
        <Stat
          label="Udløber <3 dage"
          value={data.expiringSoon}
          icon={AlertTriangle}
          color="red"
        />
        <Stat
          label="Udløbet (ikke konverteret)"
          value={data.expiredCount}
          icon={CalendarX}
          color="gray"
        />
      </div>

      {/* Floating trials first — de er vigtigst at handle på */}
      {floating.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/30 shadow-sm">
          <div className="border-b border-amber-200 px-5 py-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold text-amber-900">
                Uden abonnement ({floating.length})
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-amber-800">
              Trial udløber uden betaling med mindre de opgraderer. Oplagt
              kandidater til outreach.
            </p>
          </div>
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-amber-100 text-sm">
              <thead className="bg-amber-100/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-amber-900">
                    Bruger
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-amber-900">
                    Plan
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-amber-900">
                    Trial slutter
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-amber-900">
                    Onboarding
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100 bg-white">
                {floating.map((t) => (
                  <tr key={t.subId}>
                    <td className="whitespace-nowrap px-4 py-2">
                      <Link
                        href={`/admin/users/${t.userId}`}
                        className="text-brand-600 hover:underline"
                      >
                        {t.userName || t.userEmail}
                      </Link>
                      {t.userEmail && (
                        <div className="text-xs text-gray-500">
                          {t.userEmail}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                        {t.billingCycle}
                      </span>
                      {t.foundingTier && (
                        <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                          {t.foundingTier}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">
                          {formatDate(t.trialEndsAt)}
                        </span>
                        <UrgencyBadge
                          urgency={t.urgency}
                          daysUntilEnd={t.daysUntilEnd}
                        />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      {t.onboardingCompleted ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Fuldført
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">
                          Ikke fuldført
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Link
                        href={`/admin/users/${t.userId}`}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Detaljer
                        <ArrowRight className="ml-0.5 inline h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Committed trials — de har sagt ja til at betale */}
      {committed.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <h2 className="text-sm font-semibold text-gray-900">
                Med abonnement ({committed.length})
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-gray-600">
              Trial er knyttet til en Alunta-subscription. Når trial slutter,
              starter betalingen.
            </p>
          </div>
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Bruger
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Plan
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Trial slutter
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Alunta sub
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {committed.map((t) => (
                  <tr key={t.subId}>
                    <td className="whitespace-nowrap px-4 py-2">
                      <Link
                        href={`/admin/users/${t.userId}`}
                        className="text-brand-600 hover:underline"
                      >
                        {t.userName || t.userEmail}
                      </Link>
                      {t.userEmail && (
                        <div className="text-xs text-gray-500">
                          {t.userEmail}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                        {t.billingCycle}
                      </span>
                      {t.discountPercent && t.discountPercent > 0 && (
                        <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                          -{t.discountPercent}%
                        </span>
                      )}
                      {t.foundingTier && (
                        <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                          {t.foundingTier}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-700">
                          {formatDate(t.trialEndsAt)}
                        </span>
                        <UrgencyBadge
                          urgency={t.urgency}
                          daysUntilEnd={t.daysUntilEnd}
                        />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
                        {t.aluntaSubscriptionId?.slice(0, 8)}…
                      </code>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Link
                        href={`/admin/users/${t.userId}`}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Detaljer
                        <ArrowRight className="ml-0.5 inline h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.total === 0 && data.expiredCount === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <Beaker className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-sm text-gray-500">Ingen aktive trials</p>
        </div>
      )}

      {/* Expired trials — udløbet uden konvertering. Historisk data. */}
      {data.expiredTrials.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <CalendarX className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">
                Udløbet (ikke konverteret) — {data.expiredTrials.length}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-gray-600">
              Trial endte uden at brugeren satte betaling op. De kan stadig
              genaktivere ved at tegne abonnement — statussen flipper automatisk
              tilbage til active via Alunta webhook.
            </p>
          </div>
          <div className="overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Bruger
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Plan (planlagt)
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Udløb
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Onboarding
                  </th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.expiredTrials.map((t) => {
                  const daysSinceExpiry = t.trialEndsAt
                    ? Math.floor(
                        (Date.now() - new Date(t.trialEndsAt).getTime()) /
                          (1000 * 60 * 60 * 24),
                      )
                    : null;
                  return (
                    <tr key={t.subId} className="bg-gray-50/30">
                      <td className="whitespace-nowrap px-4 py-2">
                        <Link
                          href={`/admin/users/${t.userId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {t.userName || t.userEmail}
                        </Link>
                        {t.userEmail && (
                          <div className="text-xs text-gray-500">
                            {t.userEmail}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                          {t.billingCycle}
                        </span>
                        {t.foundingTier && (
                          <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                            {t.foundingTier}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">
                        {formatDate(t.trialEndsAt)}
                        {daysSinceExpiry !== null && (
                          <span className="ml-1 text-gray-400">
                            ({daysSinceExpiry}d siden)
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {t.onboardingCompleted ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Fuldført
                          </span>
                        ) : (
                          <span className="text-xs text-gray-500">
                            Ikke fuldført
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <Link
                          href={`/admin/users/${t.userId}`}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Detaljer
                          <ArrowRight className="ml-0.5 inline h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function DemosTab() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.admin.prospects.listDemos.useQuery();
  const setDemo = trpc.admin.prospects.setUserDemo.useMutation({
    onSuccess: () => {
      utils.admin.prospects.listDemos.invalidate();
      utils.admin.prospects.listTrials.invalidate();
      toast.success("Opdateret");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-lg bg-gray-100" />;
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Demo-brugere"
          value={data.totalDemoUsers}
          icon={FlaskConical}
          color="gray"
        />
        <Stat
          label="Organisationer"
          value={data.groups.filter((g) => g.orgId !== "__orphan__").length}
          icon={Users}
          color="gray"
        />
        <Stat
          label="Orphaned (uden org)"
          value={
            data.groups.find((g) => g.orgId === "__orphan__")?.users.length ?? 0
          }
          icon={XCircle}
          color="gray"
        />
      </div>

      <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3 text-sm text-brand-900">
        <p>
          Demo-brugere og deres data er ekskluderet fra MRR, ARR, aktive subs,
          omsætning og vækst-metrics.
        </p>
      </div>

      {data.groups.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
          <FlaskConical className="mx-auto mb-3 h-10 w-10 text-gray-400" />
          <p className="text-sm text-gray-500">Ingen demo-brugere markeret</p>
        </div>
      ) : (
        data.groups.map((group) => (
          <div
            key={group.orgId}
            className="rounded-lg border border-gray-200 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-500" />
                <h2 className="text-sm font-semibold text-gray-900">
                  {group.orgName}
                </h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {group.users.length} brugere
                </span>
              </div>
            </div>
            <div className="overflow-hidden">
              <table className="min-w-full divide-y divide-gray-100 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Bruger
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Rolle
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Oprettet
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Sidst logget ind
                    </th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.users.map((u) => (
                    <tr key={u.id}>
                      <td className="whitespace-nowrap px-4 py-2">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="text-brand-600 hover:underline"
                        >
                          {u.name || u.email}
                        </Link>
                        {u.email && (
                          <div className="text-xs text-gray-500">{u.email}</div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-600">
                        {u.orgRole ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">
                        {formatDate(u.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">
                        {formatDateTime(u.lastSession)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              confirm(
                                `Fjern demo-flag fra ${u.name || u.email}? Bliver derefter talt med i normale metrics.`,
                              )
                            ) {
                              setDemo.mutate({ userId: u.id, isDemo: false });
                            }
                          }}
                          disabled={setDemo.isPending}
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Fjern demo
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function ProspectsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("trials");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">
          Prospects & Demo
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Trials og demo-konti — hold øje med konvertering og demo-data
        </p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-4 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "trials" && <TrialsTab />}
      {activeTab === "demos" && <DemosTab />}
    </div>
  );
}
