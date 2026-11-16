"use client";

import {
  Ban,
  ChevronDown,
  Download,
  Eye,
  Flag,
  Mail,
  Search,
  Shield,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import type { AdminTableColumn } from "@/components/admin";
import { AdminTable } from "@/components/admin";
import { BulkBanDomainModal } from "@/components/admin/BulkBanDomainModal";
import { BulkEmailModal } from "@/components/admin/BulkEmailModal";
import { BulkRoleChangeModal } from "@/components/admin/BulkRoleChangeModal";
import { UserHealthScore } from "@/components/admin/UserHealthScore";
import { FoundingTierBadge } from "@/components/ui/FoundingTierBadge";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

type Segment =
  | "new_7d"
  | "inactive_30d"
  | "power"
  | "klippekort"
  | "unverified"
  | "churn_high"
  | "churn_medium"
  | undefined;
type SortBy = "created" | "name" | "lastActive";
type SortDir = "asc" | "desc";

const SEGMENT_KEYS = [
  "new_7d",
  "inactive_30d",
  "power",
  "klippekort",
  "unverified",
  "churn_high",
  "churn_medium",
] as const;

type UserRow = {
  id: string;
  name: string;
  createdAt: Date;
  onboardingCompleted: boolean;
  role: string;
  isFlagged: boolean;
  isDemo: boolean;
  clientCount: number;
  projectCount: number;
  timeEntryCount: number;
  lastActive: Date | null;
  foundingTier: string | null;
};

function SortHeader({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
}: {
  column: SortBy;
  label: string;
  sortBy: SortBy;
  sortDir: SortDir;
  onSort: (col: SortBy) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
    >
      {label}
      {sortBy === column && (
        <ChevronDown
          className={`h-3 w-3 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`}
        />
      )}
    </button>
  );
}

export default function AdminUsersPage() {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<Segment>(undefined);
  const [sortBy, setSortBy] = useState<SortBy>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk action modal states
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showBulkRole, setShowBulkRole] = useState(false);
  const [showBulkBan, setShowBulkBan] = useState(false);

  const limit = 20;
  const utils = trpc.useUtils();
  const onlyFlagged = searchParams.get("flagged") === "true";

  const { data, isLoading } = trpc.admin.listUsers.useQuery({
    limit,
    offset: page * limit,
    search: search || undefined,
    onlyFlagged: onlyFlagged || undefined,
    segment,
    sortBy,
    sortDir,
  });

  const bulkFlagMutation = trpc.admin.bulkFlagUsers.useMutation({
    onSuccess: (result) => {
      toast.success(t("list.bulk.flagged", { count: result.flagged }));
      utils.admin.listUsers.invalidate();
      setSelectedIds(new Set());
    },
    onError: (error) => toast.error(error.message),
  });

  const handleExportCsv = async () => {
    try {
      const result = await utils.admin.bulkExportCsv.fetch({
        userIds: Array.from(selectedIds),
      });
      if (result) {
        const blob = new Blob([result.csv], {
          type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = result.filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        toast.success(t("list.bulk.csvExported"));
      }
    } catch {
      toast.error(t("list.bulk.csvFailed"));
    }
  };

  // Collect emails for selected users (for ban domain modal)
  // We need user emails but don't have them in the list — pass the IDs
  // and the modal will need to fetch them. Since the BulkBanDomainModal
  // expects emails, we pass IDs and let it work with what the admin page
  // can provide. However, the user list doesn't include emails. We'll
  // pass the IDs as placeholder and handle this in the modal by fetching.
  // Actually, the ban domain modal extracts domains from emails. Since
  // we don't have emails in the list view, we'll pass selectedIds to
  // bulk fetch emails from the getUserEmail endpoint.
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);

  const handleOpenBanDomain = async () => {
    // Fetch emails for selected users
    const emails: string[] = [];
    for (const id of selectedIds) {
      try {
        const result = await utils.admin.getUserEmail.fetch({ userId: id });
        if (result?.email) {
          emails.push(result.email);
        }
      } catch {
        // Skip users whose emails can't be fetched
      }
    }
    setSelectedEmails(emails);
    setShowBulkBan(true);
  };

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(0);
  };

  const handleBulkSuccess = () => {
    utils.admin.listUsers.invalidate();
    setSelectedIds(new Set());
  };

  const columns: AdminTableColumn<UserRow>[] = [
    {
      key: "user",
      header: "",
      render: (user) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-medium">
            {user.name?.charAt(0).toUpperCase() || "?"}
          </div>
          <div>
            <p className="font-medium text-gray-900">
              {user.name || t("list.unknown")}
            </p>
            <p className="text-xs text-gray-500 font-mono">
              {user.id.slice(0, 8)}...
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "created",
      header: "",
      render: (user) => (
        <span className="text-sm text-gray-600">
          {new Date(user.createdAt).toLocaleDateString(toIntlLocale(locale), {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "health",
      header: t("list.columns.health"),
      render: (u) => <UserHealthScore userId={u.id} variant="badge" />,
    },
    {
      key: "clients",
      header: t("list.columns.clients"),
      render: (u) => (
        <span className="text-sm text-gray-600">{u.clientCount}</span>
      ),
    },
    {
      key: "projects",
      header: t("list.columns.projects"),
      render: (u) => (
        <span className="text-sm text-gray-600">{u.projectCount}</span>
      ),
    },
    {
      key: "timeEntries",
      header: t("list.columns.timeEntries"),
      render: (u) => (
        <span className="text-sm text-gray-600">{u.timeEntryCount}</span>
      ),
    },
    {
      key: "lastActive",
      header: "",
      render: (user) => (
        <span className="text-xs text-gray-500">
          {user.lastActive
            ? new Date(user.lastActive).toLocaleDateString(
                toIntlLocale(locale),
                {
                  month: "short",
                  day: "numeric",
                },
              )
            : t("list.never")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("list.columns.status"),
      render: (user) => (
        <div className="flex items-center gap-1 flex-wrap">
          {user.isDemo && (
            <span className="inline-flex rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700 ring-1 ring-purple-300">
              {t("list.badges.demo")}
            </span>
          )}
          {user.foundingTier && (
            <FoundingTierBadge tier={user.foundingTier ?? ""} />
          )}
          {user.role === "admin" && (
            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              {t("list.badges.admin")}
            </span>
          )}
          {user.role === "supporter" && (
            <span className="inline-flex rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
              {t("list.badges.supporter")}
            </span>
          )}
          {user.isFlagged && (
            <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {t("list.badges.flagged")}
            </span>
          )}
          {user.onboardingCompleted ? (
            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {t("list.badges.active")}
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
              {t("list.badges.onboarding")}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (user) => (
        <Link
          href={`/admin/users/${user.id}`}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          <Eye className="h-4 w-4" />
          {t("list.view")}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {t("list.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {t("list.total", { count: data?.total ?? 0 })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t("list.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setSegment(undefined);
              setPage(0);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${!segment ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {t("list.all")}
          </button>
          {SEGMENT_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setSegment(key as Segment);
                setPage(0);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${segment === key ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
            >
              {t(`list.segments.${key}`)}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 flex-wrap ml-auto">
          <SortHeader
            column="created"
            label={t("list.sort.created")}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
          />
          <SortHeader
            column="name"
            label={t("list.sort.name")}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
          />
          <SortHeader
            column="lastActive"
            label={t("list.sort.lastActive")}
            sortBy={sortBy}
            sortDir={sortDir}
            onSort={handleSort}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 flex-wrap">
          <span className="text-sm font-medium text-brand-700">
            {t("list.selected", { count: selectedIds.size })}
          </span>
          <button
            type="button"
            onClick={() => setShowBulkEmail(true)}
            className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
          >
            <Mail className="h-3 w-3" />
            {t("list.bulk.email")}
          </button>
          <button
            type="button"
            onClick={() => setShowBulkRole(true)}
            className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1 text-xs font-medium text-white hover:bg-purple-700"
          >
            <Shield className="h-3 w-3" />
            {t("list.bulk.role")}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
          >
            <Download className="h-3 w-3" />
            {t("list.bulk.exportCsv")}
          </button>
          <button
            type="button"
            onClick={handleOpenBanDomain}
            className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
          >
            <Ban className="h-3 w-3" />
            {t("list.bulk.banDomain")}
          </button>
          <button
            type="button"
            onClick={() => {
              const reason = window.prompt(t("list.bulk.flagPrompt"));
              if (reason)
                bulkFlagMutation.mutate({
                  userIds: Array.from(selectedIds),
                  reason,
                });
            }}
            className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            <Flag className="h-3 w-3" />
            {t("list.bulk.flag")}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 ml-auto"
          >
            {t("list.bulk.clear")}
          </button>
        </div>
      )}

      <AdminTable<UserRow>
        columns={columns}
        data={(data?.users as UserRow[]) ?? []}
        total={data?.total ?? 0}
        page={page}
        limit={limit}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyIcon={Users}
        emptyMessage={t("list.empty")}
        rowKey={(row) => row.id}
        selectedIds={selectedIds}
        onSelectChange={setSelectedIds}
      />

      {/* Bulk action modals */}
      <BulkEmailModal
        isOpen={showBulkEmail}
        onClose={() => setShowBulkEmail(false)}
        userIds={Array.from(selectedIds)}
        userCount={selectedIds.size}
        onSuccess={handleBulkSuccess}
      />
      <BulkRoleChangeModal
        isOpen={showBulkRole}
        onClose={() => setShowBulkRole(false)}
        userIds={Array.from(selectedIds)}
        userCount={selectedIds.size}
        onSuccess={handleBulkSuccess}
      />
      <BulkBanDomainModal
        isOpen={showBulkBan}
        onClose={() => setShowBulkBan(false)}
        userEmails={selectedEmails}
        onSuccess={handleBulkSuccess}
      />
    </div>
  );
}
