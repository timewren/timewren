"use client";

import {
  BriefcaseBusiness,
  Crown,
  Loader2,
  Lock,
  Shield,
  UserCog,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { trpc } from "@/providers/trpc-provider";

// hr (#464): read-all-rolle — ser medarbejdere, fravær og rapporter, men
// godkender og redigerer ikke (håndhæves i tRPC uanset kolonnen her)
const ROLES = ["owner", "admin", "hr", "manager", "member"] as const;

const ROLE_ICONS: Record<string, React.ReactNode> = {
  owner: <Crown className="h-4 w-4 text-amber-500" />,
  admin: <Shield className="h-4 w-4 text-brand-500 dark:text-brand-400" />,
  hr: <BriefcaseBusiness className="h-4 w-4 text-teal-500" />,
  manager: <UserCog className="h-4 w-4 text-violet-500" />,
  member: <Users className="h-4 w-4 text-gray-500" />,
};

const MODULE_KEYS = [
  "time",
  "tasks",
  "invoices",
  "klippekort",
  "reports",
  "settings",
  "clients",
  "projects",
  "templates",
  "calendar",
  "enterprise",
] as const;

type AccessLevel = "none" | "read" | "write";

export default function PermissionsPage() {
  const t = useTranslations("organization.permissions");
  const roleLabel = (role: string) => t(`role.${role}`);
  const moduleLabel = (moduleKey: string) => t(`module.${moduleKey}`);
  const utils = trpc.useUtils();

  const { data: myRole, isLoading: roleLoading } =
    trpc.organization.getMyRole.useQuery();

  const { data: orgPerms, isLoading } = trpc.rolePermissions.getForOrg.useQuery(
    undefined,
    {
      enabled: myRole?.canManage === true,
    },
  );

  const updateMutation = trpc.rolePermissions.update.useMutation({
    onSuccess: () => {
      utils.rolePermissions.getForOrg.invalidate();
      utils.rolePermissions.getMyPermissions.invalidate();
      toast.success(t("updated"));
    },
    onError: (err) => toast.error(err.message),
  });

  const permMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of orgPerms ?? []) {
      m.set(`${p.roleName}:${p.moduleKey}`, p.accessLevel);
    }
    return m;
  }, [orgPerms]);

  const getAccessLevel = (role: string, moduleKey: string): AccessLevel => {
    if (role === "owner") return "write";
    return (permMap.get(`${role}:${moduleKey}`) || "write") as AccessLevel;
  };

  const canEditRole = (role: string): boolean => {
    if (role === "owner") return false;
    // Only owner can edit admin permissions
    // Admins can edit member permissions
    // We detect role from myPerms: if all perms are write and it's the org context
    // For now, we allow the mutation to handle authorization server-side
    return true;
  };

  const handleChange = (
    roleName: string,
    moduleKey: string,
    accessLevel: AccessLevel,
  ) => {
    updateMutation.mutate({
      roleName: roleName as "admin" | "hr" | "manager" | "member",
      moduleKey: moduleKey as (typeof MODULE_KEYS)[number],
      accessLevel,
    });
  };

  if (roleLoading || (myRole?.canManage && isLoading)) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
      </div>
    );
  }

  // Only owners/admins may view or change role permissions.
  if (!myRole?.canManage) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader title={t("title")} description={t("description")} />
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {t("ownersOnly")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title={t("title")} description={t("description")} />

      {/* Desktop matrix view */}
      <div className="hidden md:block rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("caption")}</caption>
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th
                scope="col"
                className="sticky left-0 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-400 z-10"
              >
                {t("moduleCol")}
              </th>
              {ROLES.map((role) => (
                <th
                  scope="col"
                  key={role}
                  className="px-4 py-3 text-center font-medium text-gray-600 dark:text-gray-400"
                >
                  <div className="flex items-center justify-center gap-1.5">
                    {ROLE_ICONS[role]}
                    {roleLabel(role)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {MODULE_KEYS.map((moduleKey) => (
              <tr
                key={moduleKey}
                className="group hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
              >
                <th
                  scope="row"
                  className="sticky left-0 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800/50 px-4 py-3 font-medium text-gray-900 dark:text-white z-10"
                >
                  {moduleLabel(moduleKey)}
                </th>
                {ROLES.map((role) => {
                  const isLocked = role === "owner";
                  const level = getAccessLevel(role, moduleKey);
                  return (
                    <td key={role} className="px-4 py-3 text-center">
                      {isLocked ? (
                        <div className="flex items-center justify-center gap-1 text-gray-400 dark:text-gray-500">
                          <Lock className="h-3 w-3" />
                          <span className="text-xs">{t("full")}</span>
                        </div>
                      ) : (
                        <select
                          value={level}
                          aria-label={`${roleLabel(role)}: ${moduleLabel(moduleKey)}`}
                          onChange={(e) =>
                            handleChange(
                              role,
                              moduleKey,
                              e.target.value as AccessLevel,
                            )
                          }
                          disabled={
                            !canEditRole(role) || updateMutation.isPending
                          }
                          className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                            level === "write"
                              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
                              : level === "read"
                                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
                                : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <option value="write">{t("full")}</option>
                          <option value="read">{t("read")}</option>
                          <option value="none">{t("none")}</option>
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden space-y-3">
        {ROLES.map((role) => {
          const isLocked = role === "owner";
          return (
            <div
              key={role}
              className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
            >
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-100 dark:border-gray-700">
                {ROLE_ICONS[role]}
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {roleLabel(role)}
                </h3>
                {isLocked && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-gray-400">
                    <Lock className="h-3 w-3" />
                    {t("locked")}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {MODULE_KEYS.map((moduleKey) => {
                  const level = getAccessLevel(role, moduleKey);
                  return (
                    <div
                      key={moduleKey}
                      className="flex items-center justify-between gap-2 py-1"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {moduleLabel(moduleKey)}
                      </span>
                      {isLocked ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {t("full")}
                        </span>
                      ) : (
                        <select
                          value={level}
                          aria-label={`${roleLabel(role)}: ${moduleLabel(moduleKey)}`}
                          onChange={(e) =>
                            handleChange(
                              role,
                              moduleKey,
                              e.target.value as AccessLevel,
                            )
                          }
                          disabled={
                            !canEditRole(role) || updateMutation.isPending
                          }
                          className={`min-w-[80px] rounded-md border px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                            level === "write"
                              ? "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
                              : level === "read"
                                ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
                                : "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <option value="write">{t("full")}</option>
                          <option value="read">{t("read")}</option>
                          <option value="none">{t("none")}</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Info box */}
      <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
        <h4 className="text-sm font-medium text-brand-800 dark:text-brand-300 mb-1">
          {t("aboutTitle")}
        </h4>
        <ul className="text-sm text-brand-700 dark:text-brand-400 space-y-1">
          <li>
            {t.rich("aboutFull", {
              b: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </li>
          <li>
            {t.rich("aboutRead", {
              b: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </li>
          <li>
            {t.rich("aboutNone", {
              b: (chunks) => <span className="font-medium">{chunks}</span>,
            })}
          </li>
        </ul>
      </div>
    </div>
  );
}
