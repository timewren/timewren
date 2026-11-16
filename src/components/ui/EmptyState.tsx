"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  BarChart3,
  CheckSquare,
  Clock,
  CreditCard,
  FileText,
  FolderKanban,
  Inbox,
  Search,
  ShieldOff,
  Users,
} from "lucide-react";
import Link from "next/link";
import { toIntlLocale } from "@/i18n/format-locale";
import { Button } from "./Button";
import { useUiLocale, useUiScope } from "./use-ui-text";

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost";
}

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  secondaryAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`
        flex flex-col items-center justify-center text-center
        ${compact ? "py-8" : "py-16"}
      `}
    >
      <div
        className={`
          flex items-center justify-center
          rounded-full bg-gray-100 dark:bg-gray-800
          ${compact ? "w-12 h-12 mb-3" : "w-16 h-16 mb-4"}
        `}
      >
        <Icon
          className={`
            text-gray-400 dark:text-gray-500
            ${compact ? "w-6 h-6" : "w-8 h-8"}
          `}
        />
      </div>
      <h3
        className={`
          font-semibold text-gray-900 dark:text-gray-100
          ${compact ? "text-base mb-1" : "text-lg mb-2"}
        `}
      >
        {title}
      </h3>
      <p
        className={`
          text-gray-500 dark:text-gray-400 max-w-sm
          ${compact ? "text-sm mb-4" : "text-base mb-6"}
        `}
      >
        {description}
      </p>
      {(action || secondaryAction) && (
        <div className="flex items-center gap-3">
          {action &&
            (action.href ? (
              <Link href={action.href}>
                <Button
                  variant={action.variant || "primary"}
                  size={compact ? "sm" : "md"}
                >
                  {action.label}
                </Button>
              </Link>
            ) : (
              <Button
                variant={action.variant || "primary"}
                size={compact ? "sm" : "md"}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          {secondaryAction &&
            (secondaryAction.href ? (
              <Link href={secondaryAction.href}>
                <Button
                  variant={secondaryAction.variant || "ghost"}
                  size={compact ? "sm" : "md"}
                >
                  {secondaryAction.label}
                </Button>
              </Link>
            ) : (
              <Button
                variant={secondaryAction.variant || "ghost"}
                size={compact ? "sm" : "md"}
                onClick={secondaryAction.onClick}
              >
                {secondaryAction.label}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

// Pre-configured empty states for common entities
export function NoClientsEmptyState() {
  const t = useUiScope("empty.clients");
  return (
    <EmptyState
      icon={Users}
      title={t("title")}
      description={t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/clients/new",
      }}
      secondaryAction={{
        label: t("guide"),
        href: "/dashboard/help/clients",
        variant: "ghost",
      }}
    />
  );
}

export function NoProjectsEmptyState({
  hasClients = true,
}: {
  hasClients?: boolean;
}) {
  const t = useUiScope("empty.projects");
  if (!hasClients) {
    return (
      <EmptyState
        icon={FolderKanban}
        title={t("needClientTitle")}
        description={t("needClientDescription")}
        action={{
          label: t("createClient"),
          href: "/dashboard/clients/new",
        }}
      />
    );
  }

  return (
    <EmptyState
      icon={FolderKanban}
      title={t("title")}
      description={t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/projects/new",
      }}
      secondaryAction={{
        label: t("seeClients"),
        href: "/dashboard/clients",
        variant: "ghost",
      }}
    />
  );
}

export function NoTimeEntriesEmptyState({
  hasProjects = true,
  selectedDate,
}: {
  hasProjects?: boolean;
  selectedDate?: string;
}) {
  const t = useUiScope("empty.time");
  const intlLocale = toIntlLocale(useUiLocale());
  if (!hasProjects) {
    return (
      <EmptyState
        icon={Clock}
        title={t("needProjectTitle")}
        description={t("needProjectDescription")}
        action={{
          label: t("createProject"),
          href: "/dashboard/projects/new",
        }}
      />
    );
  }

  const dateText = selectedDate
    ? new Date(selectedDate).toLocaleDateString(intlLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : t("today");

  return (
    <EmptyState
      icon={Clock}
      title={t("title", { date: dateText })}
      description={t("description")}
      action={{
        label: t("startTimer"),
        href: "/dashboard/time",
      }}
      secondaryAction={{
        label: t("seeTemplates"),
        href: "/dashboard/templates",
        variant: "ghost",
      }}
    />
  );
}

export function NoInvoicesEmptyState({
  hasTimeEntries = true,
}: {
  hasTimeEntries?: boolean;
}) {
  const t = useUiScope("empty.invoices");
  if (!hasTimeEntries) {
    return (
      <EmptyState
        icon={FileText}
        title={t("needTimeTitle")}
        description={t("needTimeDescription")}
        action={{
          label: t("trackTime"),
          href: "/dashboard/time",
        }}
      />
    );
  }

  return (
    <EmptyState
      icon={FileText}
      title={t("title")}
      description={t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/invoices/new",
      }}
      secondaryAction={{
        label: t("seeUnbilled"),
        href: "/dashboard/time?filter=unbilled",
        variant: "ghost",
      }}
    />
  );
}

export function NoTasksEmptyState({
  hasProjects = true,
}: {
  hasProjects?: boolean;
}) {
  const t = useUiScope("empty.tasks");
  if (!hasProjects) {
    return (
      <EmptyState
        icon={CheckSquare}
        title={t("needProjectTitle")}
        description={t("needProjectDescription")}
        action={{
          label: t("createProject"),
          href: "/dashboard/projects/new",
        }}
      />
    );
  }

  return (
    <EmptyState
      icon={CheckSquare}
      title={t("title")}
      description={t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/tasks/new",
      }}
      secondaryAction={{
        label: t("seeProjects"),
        href: "/dashboard/projects",
        variant: "ghost",
      }}
    />
  );
}

export function NoKlippekortEmptyState({
  hasClients = true,
}: {
  hasClients?: boolean;
}) {
  const t = useUiScope("empty.prepaid");
  if (!hasClients) {
    return (
      <EmptyState
        icon={CreditCard}
        title={t("needClientTitle")}
        description={t("needClientDescription")}
        action={{
          label: t("createClient"),
          href: "/dashboard/clients/new",
        }}
      />
    );
  }

  return (
    <EmptyState
      icon={CreditCard}
      title={t("title")}
      description={t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/klippekort/new",
      }}
      secondaryAction={{
        label: t("seeClients"),
        href: "/dashboard/clients",
        variant: "ghost",
      }}
    />
  );
}

export function NoReportsEmptyState() {
  const t = useUiScope("empty.reports");
  return (
    <EmptyState
      icon={BarChart3}
      title={t("title")}
      description={t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/time",
      }}
    />
  );
}

export function NoSearchResultsEmptyState({ query }: { query?: string }) {
  const t = useUiScope("empty.search");
  return (
    <EmptyState
      icon={Search}
      title={t("title")}
      description={query ? t("descriptionQuery", { query }) : t("description")}
      secondaryAction={{
        label: t("clear"),
        variant: "ghost",
      }}
    />
  );
}

// Error state component
interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  const t = useUiScope("empty.error");
  return (
    <EmptyState
      icon={AlertCircle}
      title={title ?? t("title")}
      description={description ?? t("description")}
      action={
        onRetry
          ? {
              label: t("retry"),
              onClick: onRetry,
              variant: "primary",
            }
          : undefined
      }
    />
  );
}

// Module-disabled state: samme visuelle mønster brugt af Klippekort/Kunder/
// Fakturaer m.fl. når tRPC svarer FORBIDDEN fra guardedRouter (se
// isModuleDisabledError i src/lib/modules/forbidden-error.ts) i stedet for en
// generisk fejlbesked eller rå tekst, som ser ud som et nedbrud.
interface ModuleDisabledStateProps {
  title?: string;
  description?: string;
}

export function ModuleDisabledState({
  title,
  description,
}: ModuleDisabledStateProps) {
  const t = useUiScope("empty.moduleDisabled");
  return (
    <EmptyState
      icon={ShieldOff}
      title={title ?? t("title")}
      description={description ?? t("description")}
      action={{
        label: t("action"),
        href: "/dashboard/settings/modules",
        variant: "secondary",
      }}
    />
  );
}
