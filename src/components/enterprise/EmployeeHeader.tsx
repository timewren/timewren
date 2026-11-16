"use client";

import { Briefcase, Building2, Calendar, Clock, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";

interface EmployeeHeaderProps {
  name: string;
  email?: string;
  role?: string;
  department?: { id: string; name: string } | null;
  employmentType: string;
  weeklyHours: number;
  startDate?: string | null;
}

const EMPLOYMENT_KEYS: Record<string, string> = {
  full_time: "employment.fullTime",
  fulltime: "employment.fullTime",
  part_time: "employment.partTime",
  parttime: "employment.partTime",
  flexjob: "employment.flexjob",
};

const ROLE_KEYS = ["owner", "admin", "hr", "manager", "member"];

export function EmployeeHeader({
  name,
  email,
  role,
  department,
  employmentType,
  weeklyHours,
  startDate,
}: EmployeeHeaderProps) {
  const t = useTranslations("enterpriseComponents.header");
  const tc = useTranslations("enterpriseCommon");
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 dark:bg-tt-gran-lys">
          <UserCog className="h-6 w-6 text-brand-600 dark:text-brand-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {name}
          </h2>
          {email && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{email}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-300">
            {role && (
              <span className="flex items-center gap-1">
                <UserCog className="h-3.5 w-3.5" />
                {ROLE_KEYS.includes(role) ? tc(`roles.${role}`) : role}
              </span>
            )}
            {department && (
              <span className="flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" />
                {department.name}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Briefcase className="h-3.5 w-3.5" />
              {EMPLOYMENT_KEYS[employmentType]
                ? tc(EMPLOYMENT_KEYS[employmentType])
                : employmentType}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {t("hoursPerWeek", { hours: weeklyHours })}
            </span>
            {startDate && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {t("employedSince", { date: startDate })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
