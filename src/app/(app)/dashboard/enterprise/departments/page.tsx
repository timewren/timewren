"use client";

import { Layers, Plus, Trash2, UserCog, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { roleSatisfies } from "@/lib/permissions/org-role";
import { trpc } from "@/providers/trpc-provider";

interface Department {
  id: string;
  name: string;
  memberCount?: number;
}

type ManagerRole = "lead" | "deputy";

interface ManagerDraft {
  userId: string;
  role: ManagerRole;
  validFrom: string;
  validTo: string;
}

const inputClass =
  "rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20";

function formatPeriod(
  from: string | null,
  to: string | null,
  intlLocale: string,
  t: (key: string, values?: Record<string, string>) => string,
): string | null {
  if (!from && !to) return null;
  const f = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(intlLocale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (from && to) return `${f(from)}–${f(to)}`;
  if (from) return t("departments.periodFrom", { date: f(from) });
  return t("departments.periodTo", { date: f(to as string) });
}

/** Redigér ledere/stedfortrædere for én afdeling (#464). */
function ManagersEditor({
  departmentId,
  initial,
  candidates,
  onClose,
}: {
  departmentId: string;
  initial: ManagerDraft[];
  candidates: Array<{ userId: string; name: string }>;
  onClose: () => void;
}) {
  const t = useTranslations("enterprise");
  const utils = trpc.useUtils();
  const [rows, setRows] = useState<ManagerDraft[]>(initial);

  const setMutation = trpc.enterprise.departmentManagers.set.useMutation({
    onSuccess: () => {
      utils.enterprise.departmentManagers.list.invalidate();
      toast.success(t("departments.managersSaved"));
      onClose();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const update = (i: number, patch: Partial<ManagerDraft>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const usedIds = new Set(rows.map((r) => r.userId));
  const firstFree = candidates.find((c) => !usedIds.has(c.userId));

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
      {rows.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("departments.noManagers")}
        </p>
      )}
      {rows.map((r, i) => (
        <div key={r.userId} className="flex flex-wrap items-center gap-2">
          <select
            value={r.userId}
            aria-label={t("departments.user")}
            onChange={(e) => update(i, { userId: e.target.value })}
            className={`${inputClass} min-w-[160px] flex-1`}
          >
            {candidates.map((c) => (
              <option
                key={c.userId}
                value={c.userId}
                disabled={c.userId !== r.userId && usedIds.has(c.userId)}
              >
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={r.role}
            aria-label={t("departments.role")}
            onChange={(e) => update(i, { role: e.target.value as ManagerRole })}
            className={inputClass}
          >
            <option value="lead">{t("departments.managerLead")}</option>
            <option value="deputy">{t("departments.managerDeputy")}</option>
          </select>
          <input
            type="date"
            value={r.validFrom}
            aria-label={t("departments.validFrom")}
            onChange={(e) => update(i, { validFrom: e.target.value })}
            className={inputClass}
          />
          <span className="text-xs text-gray-400">–</span>
          <input
            type="date"
            value={r.validTo}
            aria-label={t("departments.validTo")}
            onChange={(e) => update(i, { validTo: e.target.value })}
            className={inputClass}
          />
          <button
            type="button"
            aria-label={t("departments.remove")}
            onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
            className="rounded p-1 text-gray-400 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!firstFree}
          onClick={() =>
            firstFree &&
            setRows((prev) => [
              ...prev,
              {
                userId: firstFree.userId,
                role: prev.length === 0 ? "lead" : "deputy",
                validFrom: "",
                validTo: "",
              },
            ])
          }
        >
          <Plus className="mr-1 h-4 w-4" /> {t("departments.add")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t("departments.cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={setMutation.isPending}
            onClick={() =>
              setMutation.mutate({
                departmentId,
                managers: rows.map((r) => ({
                  userId: r.userId,
                  role: r.role,
                  validFrom: r.validFrom || null,
                  validTo: r.validTo || null,
                })),
              })
            }
          >
            {t("departments.save")}
          </Button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        {t("departments.periodNote")}
      </p>
    </div>
  );
}

function DepartmentsPageContent() {
  const t = useTranslations("enterprise");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [managersFor, setManagersFor] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: departments, isLoading } =
    trpc.enterprise.listDepartments.useQuery();
  const { data: managers } = trpc.enterprise.departmentManagers.list.useQuery();
  const { data: members } = trpc.enterprise.listMembers.useQuery();
  const { data: myRole } = trpc.rolePermissions.getMyRole.useQuery(undefined, {
    staleTime: 60_000,
  });
  const isAdmin = roleSatisfies(myRole?.role, "admin");

  const candidates = useMemo(
    () =>
      (members ?? [])
        .filter((m) => m.isActive)
        .map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [members, locale],
  );

  const managersByDept = useMemo(() => {
    const map = new Map<string, NonNullable<typeof managers>>();
    for (const m of managers ?? []) {
      const list = map.get(m.departmentId) ?? [];
      list.push(m);
      map.set(m.departmentId, list);
    }
    return map;
  }, [managers]);

  const createMutation = trpc.enterprise.createDepartment.useMutation({
    onSuccess: () => {
      utils.enterprise.listDepartments.invalidate();
      setName("");
      toast.success(t("departments.created"));
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const updateMutation = trpc.enterprise.updateDepartment.useMutation({
    onSuccess: () => {
      utils.enterprise.listDepartments.invalidate();
      setEditId(null);
      toast.success(t("departments.updated"));
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const deleteMutation = trpc.enterprise.deleteDepartment.useMutation({
    onSuccess: () => {
      utils.enterprise.listDepartments.invalidate();
      utils.enterprise.departmentManagers.list.invalidate();
      toast.success(t("departments.deleted"));
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t("departments.title")} />

      {/* Create form */}
      {isAdmin && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate({ name: name.trim() });
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("departments.newPlaceholder")}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
          />
          <Button
            type="submit"
            disabled={!name.trim() || createMutation.isPending}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("departments.create")}
          </Button>
        </form>
      )}

      {/* Department list */}
      {isLoading ? (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : !departments || departments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center dark:border-gray-800">
          <Layers className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 text-gray-500 dark:text-gray-400">
            {t("departments.empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {departments.map((dept: Department) => {
            const deptManagers = managersByDept.get(dept.id) ?? [];
            return (
              <div
                key={dept.id}
                className="rounded-lg border border-gray-200 p-4 dark:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  {editId === dept.id ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        updateMutation.mutate({ id: dept.id, name: editName });
                      }}
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                        ref={(el) => {
                          el?.focus();
                        }}
                      />
                      <Button type="submit" size="sm">
                        {t("departments.save")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditId(null)}
                      >
                        {t("departments.cancel")}
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {dept.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t("departments.memberCount", {
                            count: dept.memberCount ?? 0,
                          })}
                        </p>
                        {deptManagers.length > 0 && (
                          <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {deptManagers.map((m) => {
                              const period = formatPeriod(
                                m.validFrom,
                                m.validTo,
                                intlLocale,
                                t,
                              );
                              return (
                                <li
                                  key={m.id}
                                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    m.role === "lead"
                                      ? "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
                                      : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                  }`}
                                  title={period ?? undefined}
                                >
                                  <UserCog className="h-3 w-3" />
                                  {m.role === "lead"
                                    ? t("departments.managerLead")
                                    : m.role === "deputy"
                                      ? t("departments.managerDeputy")
                                      : m.role}
                                  : {m.user?.name ?? m.userId}
                                  {period && (
                                    <span className="opacity-70">
                                      ({period})
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setManagersFor(
                                managersFor === dept.id ? null : dept.id,
                              )
                            }
                          >
                            <UserCog className="mr-1 h-4 w-4" />{" "}
                            {t("departments.managersButton")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditId(dept.id);
                              setEditName(dept.name);
                            }}
                          >
                            {t("departments.edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              deleteMutation.mutate({ id: dept.id })
                            }
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {managersFor === dept.id && isAdmin && (
                  <ManagersEditor
                    departmentId={dept.id}
                    candidates={candidates}
                    initial={deptManagers.map((m) => ({
                      userId: m.userId,
                      role: (m.role as ManagerRole) ?? "lead",
                      validFrom: m.validFrom ?? "",
                      validTo: m.validTo ?? "",
                    }))}
                    onClose={() => setManagersFor(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DepartmentsPage() {
  return (
    <ModuleGuard module="enterprise">
      <RoleGuard minRole="manager">
        <DepartmentsPageContent />
      </RoleGuard>
    </ModuleGuard>
  );
}
