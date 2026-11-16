"use client";

import { skipToken } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { trpc } from "@/providers/trpc-provider";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map(
  (key, i) => ({ value: String(i + 1), key }),
);

interface EmployeeProfileFormProps {
  editId: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EmployeeProfileForm({
  editId,
  onClose,
  onSuccess,
}: EmployeeProfileFormProps) {
  const fid = useId();
  const t = useTranslations("enterpriseComponents.profileForm");
  const te = useTranslations("enterprise");
  const tc = useTranslations("enterpriseCommon");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"admin" | "hr" | "manager" | "member">(
    "member",
  );
  const [employmentType, setEmploymentType] = useState<
    "full_time" | "part_time" | "flexjob"
  >("full_time");
  const [weeklyHours, setWeeklyHours] = useState(37);
  const [workingDays, setWorkingDays] = useState(["1", "2", "3", "4", "5"]);
  const [startDate, setStartDate] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [managerId, setManagerId] = useState("");
  // Valgfri override af org'ens dagsnorm/pause (#449) — tom = arv fra org
  const [dailyNormHours, setDailyNormHours] = useState("");
  const [breakMinutes, setBreakMinutes] = useState("");

  const { data: existingProfile } = trpc.enterprise.getProfileById.useQuery(
    editId ? { id: editId } : skipToken,
  );
  const { data: members } = trpc.enterprise.listMembers.useQuery();
  const { data: departments } = trpc.enterprise.listDepartments.useQuery();
  // Only users without a profile yet can have one created.
  const { data: addableMembers } = trpc.enterprise.listAddableMembers.useQuery(
    undefined,
    {
      enabled: !editId,
    },
  );

  const createMutation = trpc.enterprise.createProfile.useMutation({
    onSuccess,
    onError: (err) => toast.error(err.message || t("createFailed")),
  });
  const updateMutation = trpc.enterprise.updateProfile.useMutation({
    onSuccess,
    onError: (err) => toast.error(err.message || t("saveFailed")),
  });

  useEffect(() => {
    if (existingProfile) {
      setRole(existingProfile.role as "admin" | "hr" | "manager" | "member");
      setEmploymentType(
        existingProfile.employmentType as "full_time" | "part_time" | "flexjob",
      );
      setWeeklyHours(Number(existingProfile.weeklyHours));
      setWorkingDays(existingProfile.workingDays ?? ["1", "2", "3", "4", "5"]);
      setStartDate(existingProfile.startDate ?? "");
      setDepartmentId(existingProfile.departmentId ?? "");
      setManagerId(existingProfile.managerId ?? "");
      setDailyNormHours(
        existingProfile.dailyNormHours != null
          ? String(Number(existingProfile.dailyNormHours)).replace(".", ",")
          : "",
      );
      setBreakMinutes(
        existingProfile.breakMinutes != null
          ? String(existingProfile.breakMinutes)
          : "",
      );
    }
  }, [existingProfile]);

  // Candidate managers: other active profiles in the org (never self).
  const managerCandidates = (members ?? []).filter(
    (m) => m.id !== editId && m.isActive !== false,
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dailyNormRaw = dailyNormHours.trim().replace(",", ".");
    const dailyNorm = dailyNormRaw === "" ? null : Number(dailyNormRaw);
    if (
      dailyNorm !== null &&
      (Number.isNaN(dailyNorm) || dailyNorm < 0.5 || dailyNorm > 24)
    ) {
      toast.error(t("dailyNormRange"));
      return;
    }
    const breakRaw = breakMinutes.trim();
    const breakOverride = breakRaw === "" ? null : Number(breakRaw);
    if (
      breakOverride !== null &&
      (!Number.isInteger(breakOverride) ||
        breakOverride < 0 ||
        breakOverride > 240)
    ) {
      toast.error(t("breakRange"));
      return;
    }
    const payload = {
      role,
      employmentType,
      weeklyHours: String(weeklyHours),
      workingDays,
      startDate: startDate || undefined,
      dailyNormHours: dailyNorm,
      breakMinutes: breakOverride,
    };

    if (editId) {
      // On update, null clears the field; undefined leaves it untouched.
      updateMutation.mutate({
        id: editId,
        ...payload,
        departmentId: departmentId || null,
        managerId: managerId || null,
      });
    } else {
      createMutation.mutate({
        userId,
        ...payload,
        departmentId: departmentId || undefined,
        managerId: managerId || undefined,
      });
    }
  };

  const toggleDay = (day: string) => {
    setWorkingDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort(),
    );
  };

  const inputClass =
    "w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-gray-200/80 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            {editId ? t("titleEdit") : t("titleCreate")}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!editId && (
            <div>
              <label
                htmlFor={`${fid}-f1`}
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("employee")}
              </label>
              <select
                id={`${fid}-f1`}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">{t("chooseEmployee")}</option>
                {addableMembers?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email ?? m.userId}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor={`${fid}-f2`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("role")}
            </label>
            <select
              id={`${fid}-f2`}
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "admin" | "hr" | "manager" | "member")
              }
              className={inputClass}
            >
              <option value="member">{tc("roles.member")}</option>
              <option value="manager">{tc("roles.manager")}</option>
              <option value="hr">{t("roleHr")}</option>
              <option value="admin">{tc("roles.admin")}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor={`${fid}-f3`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("employmentType")}
            </label>
            <select
              id={`${fid}-f3`}
              value={employmentType}
              onChange={(e) => {
                const type = e.target.value as typeof employmentType;
                setEmploymentType(type);
                if (type === "full_time") setWeeklyHours(37);
              }}
              className={inputClass}
            >
              <option value="full_time">{tc("employment.fullTime")}</option>
              <option value="part_time">{tc("employment.partTime")}</option>
              <option value="flexjob">{tc("employment.flexjob")}</option>
            </select>
          </div>

          <div>
            <label
              htmlFor={`${fid}-f4`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("hoursPerWeek")}
            </label>
            <input
              id={`${fid}-f4`}
              type="number"
              step="0.5"
              min="1"
              max="60"
              value={weeklyHours}
              onChange={(e) => setWeeklyHours(Number(e.target.value))}
              className={inputClass}
            />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("workingDays")}
            </span>
            <div className="flex gap-1">
              {WEEKDAYS.map((day) => (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => toggleDay(day.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    workingDays.includes(day.value)
                      ? "bg-tt-gran text-tt-paa-gran"
                      : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                  }`}
                >
                  {te(`weekdays.${day.key}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="profile-daily-norm"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("dailyNorm")}
              </label>
              <input
                id="profile-daily-norm"
                type="text"
                inputMode="decimal"
                value={dailyNormHours}
                onChange={(e) => setDailyNormHours(e.target.value)}
                placeholder={t("inheritOrg")}
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="profile-break-minutes"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("breakMinutes")}
              </label>
              <input
                id="profile-break-minutes"
                type="number"
                min={0}
                max={240}
                step={5}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                placeholder={t("inheritOrg")}
                className={inputClass}
              />
            </div>
            <p className="col-span-2 -mt-1 text-xs text-gray-400 dark:text-gray-500">
              {t("overrideHint")}
            </p>
          </div>

          <div>
            <label
              htmlFor={`${fid}-f5`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("startDate")}
            </label>
            <input
              id={`${fid}-f5`}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor={`${fid}-f6`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("department")}
            </label>
            <select
              id={`${fid}-f6`}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("noDepartment")}</option>
              {departments?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor={`${fid}-f7`}
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {t("manager")}
            </label>
            <select
              id={`${fid}-f7`}
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("noManager")}</option>
              {managerCandidates.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user?.name ?? m.userId}
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editId ? t("saveChanges") : t("createProfile")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
