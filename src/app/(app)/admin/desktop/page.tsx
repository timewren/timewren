"use client";

import {
  ClipboardCopy,
  Download,
  Key,
  Laptop,
  Loader2,
  Mail,
  Monitor,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Timer,
  Trash2,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";

// ============================================
// Types
// ============================================
type Tab = "licenser" | "devices" | "trials" | "venteliste" | "analytics";

const tabs: {
  key: Tab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "licenser", label: "Licenser", icon: Key },
  { key: "devices", label: "Devices", icon: Laptop },
  { key: "trials", label: "Trials", icon: Timer },
  { key: "venteliste", label: "Venteliste", icon: Mail },
  { key: "analytics", label: "Analytics", icon: TrendingUp },
];

// ============================================
// Stats Cards
// ============================================
function StatCard({
  label,
  value,
  icon: Icon,
  color = "blue",
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color?: "blue" | "green" | "amber" | "purple" | "red";
}) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    purple: "bg-purple-50 text-purple-600",
    red: "bg-red-50 text-red-600",
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
        </div>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${colorMap[color]}`}
        >
          <Icon className="h-4.5 w-4.5" />
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="h-4 w-20 rounded bg-gray-200" />
          <div className="mt-2 h-7 w-16 rounded bg-gray-200" />
        </div>
        <div className="h-9 w-9 rounded-lg bg-gray-100" />
      </div>
    </div>
  );
}

// ============================================
// Create License Dialog
// ============================================
function CreateLicenseForm({ onClose }: { onClose: () => void }) {
  const [tier, setTier] = useState<"lifetime" | "solo" | "team">("lifetime");
  const [email, setEmail] = useState("");
  const [maxDevices, setMaxDevices] = useState("");
  const [note, setNote] = useState("");
  const utils = trpc.useUtils();

  const createMutation = trpc.admin.desktop.createLicense.useMutation({
    onSuccess: (data) => {
      toast.success(`Licens oprettet: ${data.licenseKey}`);
      utils.admin.desktop.listLicenses.invalidate();
      utils.admin.desktop.getDesktopStats.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">
        Opret ny licens
      </h3>
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Tier
            <select
              value={tier}
              onChange={(e) =>
                setTier(e.target.value as "lifetime" | "solo" | "team")
              }
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="lifetime">Lifetime</option>
              <option value="solo">Solo</option>
              <option value="team">Team</option>
            </select>
          </label>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Email (valgfrit)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="bruger@example.com"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Hvis brugeren findes, tilknyttes licensen automatisk
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Max devices (valgfrit)
            <input
              type="number"
              value={maxDevices}
              onChange={(e) => setMaxDevices(e.target.value)}
              placeholder="Standard: 3 (lifetime), 2 (solo), 10 (team)"
              min={1}
              max={100}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Note (valgfrit)
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Intern note..."
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </label>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              createMutation.mutate({
                tier,
                email: email || undefined,
                maxDevices: maxDevices ? Number(maxDevices) : undefined,
                note: note || undefined,
              });
            }}
            disabled={createMutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <Loader2 className="inline h-4 w-4 animate-spin" />
            ) : (
              "Opret licens"
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Annuller
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Licenses Tab
// ============================================
function LicensesTab() {
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const utils = trpc.useUtils();

  const { data: licenses, isLoading } =
    trpc.admin.desktop.listLicenses.useQuery({
      tier: (tierFilter as "lifetime" | "solo" | "team") || undefined,
      status: (statusFilter as "active" | "inactive") || undefined,
      search: search || undefined,
    });

  const deactivateMutation = trpc.admin.desktop.deactivateLicense.useMutation({
    onSuccess: () => {
      toast.success("Licens deaktiveret");
      utils.admin.desktop.listLicenses.invalidate();
      utils.admin.desktop.getDesktopStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const reactivateMutation = trpc.admin.desktop.reactivateLicense.useMutation({
    onSuccess: () => {
      toast.success("Licens reaktiveret");
      utils.admin.desktop.listLicenses.invalidate();
      utils.admin.desktop.getDesktopStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const refundMutation = trpc.admin.desktop.refundLicense.useMutation({
    onSuccess: () => {
      toast.success("Licens refunderet og deaktiveret");
      utils.admin.desktop.listLicenses.invalidate();
      utils.admin.desktop.getDesktopStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      {showCreate && <CreateLicenseForm onClose={() => setShowCreate(false)} />}

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Soeg efter noegle eller note..."
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Alle tiers</option>
          <option value="lifetime">Lifetime</option>
          <option value="solo">Solo</option>
          <option value="team">Team</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Alle status</option>
          <option value="active">Aktiv</option>
          <option value="inactive">Inaktiv</option>
        </select>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" />
          Opret licens
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Noegle
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Tier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Bruger
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Devices
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Oprettet
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                  Handlinger
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {licenses?.map((license) => (
                <tr key={license.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-gray-900">
                        {license.licenseKey}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(license.licenseKey);
                          toast.success("Kopieret");
                        }}
                        className="text-gray-400 hover:text-gray-600"
                        title="Kopier"
                      >
                        <ClipboardCopy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {license.note && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {license.note}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        license.tier === "lifetime"
                          ? "bg-purple-100 text-purple-700"
                          : license.tier === "team"
                            ? "bg-brand-100 text-brand-700"
                            : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {license.tier}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {license.userEmail ?? (
                      <span className="text-gray-400">Ikke tildelt</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {license.devicesUsed}/{license.maxDevices}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        license.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {license.isActive ? (
                        <>
                          <ShieldCheck className="h-3 w-3" />
                          Aktiv
                        </>
                      ) : (
                        <>
                          <XCircle className="h-3 w-3" />
                          Inaktiv
                        </>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {new Date(license.createdAt).toLocaleDateString("da-DK")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {license.isActive && license.hasPayment && (
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              confirm(
                                "Refunder betalingen i Stripe og deaktiver licensen?",
                              )
                            ) {
                              refundMutation.mutate({ licenseId: license.id });
                            }
                          }}
                          disabled={refundMutation.isPending}
                          className="text-sm text-amber-600 hover:text-amber-800"
                        >
                          Refunder
                        </button>
                      )}
                      {license.isActive ? (
                        <button
                          type="button"
                          onClick={() =>
                            deactivateMutation.mutate({
                              licenseId: license.id,
                            })
                          }
                          disabled={deactivateMutation.isPending}
                          className="text-sm text-red-600 hover:text-red-800"
                        >
                          Deaktiver
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            reactivateMutation.mutate({
                              licenseId: license.id,
                            })
                          }
                          disabled={reactivateMutation.isPending}
                          className="text-sm text-brand-600 hover:text-brand-800"
                        >
                          Reaktiver
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {licenses?.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    Ingen licenser fundet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================
// Devices Tab
// ============================================
function DevicesTab() {
  const utils = trpc.useUtils();
  const { data: devices, isLoading } =
    trpc.admin.desktop.listDevices.useQuery();

  const removeMutation = trpc.admin.desktop.removeDevice.useMutation({
    onSuccess: () => {
      toast.success("Enhed fjernet");
      utils.admin.desktop.listDevices.invalidate();
      utils.admin.desktop.getDesktopStats.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
              Enhed
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
              Machine ID
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
              OS
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
              Bruger
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
              Sidst synkroniseret
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
              Handlinger
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {devices?.map((device) => (
            <tr key={device.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-gray-400" />
                  {device.deviceName || "Ukendt enhed"}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                <code className="text-xs text-gray-500">
                  {device.machineId.slice(0, 16)}...
                </code>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                {device.os ?? "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                {device.userEmail ?? "-"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                {device.lastSyncAt
                  ? new Date(device.lastSyncAt).toLocaleString("da-DK")
                  : "Aldrig"}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right">
                <button
                  type="button"
                  onClick={() => removeMutation.mutate({ deviceId: device.id })}
                  disabled={removeMutation.isPending}
                  className="text-red-600 hover:text-red-800"
                  title="Fjern enhed"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
          {devices?.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-12 text-center text-sm text-gray-500"
              >
                Ingen enheder registreret
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================
// Trials Tab
// ============================================
function TrialsTab() {
  const [statusFilter, setStatusFilter] = useState<
    "active" | "expired" | undefined
  >(undefined);
  const { data: trials, isLoading } = trpc.admin.desktop.listTrials.useQuery({
    status: statusFilter,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={statusFilter ?? ""}
          onChange={(e) =>
            setStatusFilter(
              (e.target.value as "active" | "expired") || undefined,
            )
          }
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Alle trials</option>
          <option value="active">Aktive</option>
          <option value="expired">Udloebne</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Machine ID
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  OS
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Startdato
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Dage tilbage
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {trials?.map((trial) => (
                <tr key={trial.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3">
                    <code className="text-xs text-gray-600">
                      {trial.machineId.slice(0, 20)}...
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {trial.os ?? "-"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                    {trial.startedAt}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 font-medium">
                    {trial.daysRemaining}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        trial.isExpired
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {trial.isExpired ? "Udloebet" : "Aktiv"}
                    </span>
                  </td>
                </tr>
              ))}
              {trials?.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    Ingen trials fundet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================
// Waitlist Tab
// ============================================
function WaitlistTab() {
  const { data: entries, isLoading } =
    trpc.admin.desktop.listWaitlist.useQuery();
  const csvQuery = trpc.admin.desktop.getWaitlistCsv.useQuery(undefined, {
    enabled: false,
  });

  const handleExportCsv = async () => {
    const result = await csvQuery.refetch();
    if (result.data) {
      const blob = new Blob([result.data], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `desktop-waitlist-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV eksporteret");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {entries?.length ?? 0} tilmeldte total
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Eksporter CSV
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Tilmeldt
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {entries?.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                    {entry.email}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                    {new Date(entry.createdAt).toLocaleDateString("da-DK")}
                  </td>
                </tr>
              ))}
              {entries?.length === 0 && (
                <tr>
                  <td
                    colSpan={2}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    Ingen paa ventelisten
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================
// Analytics Tab
// ============================================
function AnalyticsTab() {
  const [days, setDays] = useState<"7" | "30" | "90">("7");
  const { data, isLoading } = trpc.admin.desktop.getDesktopAnalytics.useQuery({
    days,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={days}
          onChange={(e) => setDays(e.target.value as "7" | "30" | "90")}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="7">Sidste 7 dage</option>
          <option value="30">Sidste 30 dage</option>
          <option value="90">Sidste 90 dage</option>
        </select>
        {data && (
          <p className="text-sm text-gray-500">
            {data.total} events i perioden
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Popular events */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Populaere events
            </h3>
            <div className="space-y-2">
              {data?.popularEvents.map((event) => (
                <div
                  key={event.event}
                  className="flex items-center justify-between"
                >
                  <code className="text-sm text-gray-700">{event.event}</code>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {event.count}
                  </span>
                </div>
              ))}
              {data?.popularEvents.length === 0 && (
                <p className="text-sm text-gray-500">Ingen events endnu</p>
              )}
            </div>
          </div>

          {/* Platform breakdown */}
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Platforme
            </h3>
            <div className="space-y-2">
              {data?.platformBreakdown.map((p) => (
                <div
                  key={p.platform ?? "unknown"}
                  className="flex items-center justify-between"
                >
                  <span className="text-sm text-gray-700">
                    {p.platform ?? "Ukendt"}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {p.count}
                  </span>
                </div>
              ))}
              {data?.platformBreakdown.length === 0 && (
                <p className="text-sm text-gray-500">Ingen data endnu</p>
              )}
            </div>
          </div>

          {/* Recent events */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Seneste events
            </h3>
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Event
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Platform
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Version
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                      Tidspunkt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {data?.recentEvents.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2">
                        <code className="text-xs text-gray-700">
                          {event.event}
                        </code>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {event.platform ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {event.appVersion ?? "-"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">
                        {new Date(event.createdAt).toLocaleString("da-DK")}
                      </td>
                    </tr>
                  ))}
                  {data?.recentEvents.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-8 text-center text-sm text-gray-500"
                      >
                        Ingen events endnu
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main Page
// ============================================
export default function DesktopAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("licenser");
  const { data: stats, isLoading: statsLoading } =
    trpc.admin.desktop.getDesktopStats.useQuery();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Desktop App</h1>
        <p className="mt-1 text-sm text-gray-500">
          Licenser, enheder, trials, venteliste og analytics for desktop-appen
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statsLoading ? (
          ["lic", "dev", "tri", "wait", "ana", "rev", "ref"].map((k) => (
            <SkeletonCard key={k} />
          ))
        ) : (
          <>
            <StatCard
              label="Aktive licenser"
              value={stats?.licenses.total ?? 0}
              icon={Key}
              color="purple"
            />
            <StatCard
              label="Registrerede devices"
              value={stats?.devices ?? 0}
              icon={Smartphone}
              color="blue"
            />
            <StatCard
              label="Aktive trials"
              value={stats?.trials.active ?? 0}
              icon={Timer}
              color="green"
            />
            <StatCard
              label="Venteliste"
              value={stats?.waitlist ?? 0}
              icon={Users}
              color="amber"
            />
            <StatCard
              label="Events (7 dage)"
              value={stats?.analyticsLast7Days ?? 0}
              icon={TrendingUp}
              color="blue"
            />
            <StatCard
              label="Omsætning (livstid)"
              value={`${(stats?.sales.revenueDkk ?? 0).toLocaleString("da-DK")} kr`}
              icon={TrendingUp}
              color="green"
            />
            <StatCard
              label="Refunderinger"
              value={`${stats?.sales.refunded ?? 0} (${stats?.sales.refundRate ?? 0}%)`}
              icon={Timer}
              color="red"
            />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-4 overflow-x-auto">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-brand-500 text-brand-600"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "licenser" && <LicensesTab />}
      {activeTab === "devices" && <DevicesTab />}
      {activeTab === "trials" && <TrialsTab />}
      {activeTab === "venteliste" && <WaitlistTab />}
      {activeTab === "analytics" && <AnalyticsTab />}
    </div>
  );
}
