import { Text } from "@react-email/components";
import type { ReactNode } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL, MAIL_FONT, MAIL_STATUS } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailShell,
  EmailStats,
  emailText,
} from "./EmailShell";

export interface TaskItem {
  title: string;
  projectName?: string;
  priority?: string;
  deadline?: string;
}

export type TaskNotificationEmailProps = {
  /** Modtagerens sprog (standard "da") */
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
} & (
  | {
      kind: "daily_digest";
      name: string;
      dateLabel: string;
      tasksToday: TaskItem[];
      overdueCount: number;
      completedYesterday: number;
      tasksUrl: string;
    }
  | {
      kind: "deadline_reminder";
      name: string;
      task?: TaskItem;
      tasksUrl: string;
    }
  | { kind: "overdue_alert"; name: string; tasks: TaskItem[]; tasksUrl: string }
  | {
      kind: "weekly_review";
      name: string;
      tasksCompleted: number;
      hoursTracked: number;
      tasksCreated: number;
      dashboardUrl: string;
    }
  | {
      kind: "ai_suggestion";
      name: string;
      suggestion: string;
      tasksUrl: string;
    }
  | { kind: "general"; name: string; message: string; url?: string }
);

function TaskRow({
  task,
  tone,
  locale,
}: {
  task: TaskItem;
  tone?: "late" | "soon";
  locale: string;
}) {
  const t = mailT("emailsReports", locale);
  const meta = [
    task.projectName,
    task.deadline
      ? tone === "late"
        ? t("tasks.deadlineWas", { date: task.deadline })
        : t("tasks.deadline", { date: task.deadline })
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  const urgent = tone === "late" || task.priority === "urgent";
  return (
    <table
      role="presentation"
      border={0}
      cellPadding={0}
      cellSpacing={0}
      width="100%"
      style={{ borderBottom: `1px solid ${MAIL.line}` }}
    >
      <tbody>
        <tr>
          <td style={{ fontFamily: MAIL_FONT, padding: "10px 0" }}>
            <p
              style={{
                color: MAIL.text,
                fontSize: "15px",
                fontWeight: 600,
                lineHeight: "22px",
                margin: 0,
              }}
            >
              {task.title}
              {urgent && (
                <span
                  style={{
                    color: MAIL_STATUS.danger.text,
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  {"  "}
                  {tone === "late" ? t("tasks.late") : t("tasks.urgent")}
                </span>
              )}
            </p>
            {meta && (
              <p
                className="tt-muted"
                style={{
                  color: MAIL.muted,
                  fontSize: "14px",
                  lineHeight: "20px",
                  margin: "2px 0 0 0",
                }}
              >
                {meta}
              </p>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function Shell({
  preview,
  heading,
  locale,
  mailBrand,
  children,
}: {
  preview: string;
  heading: string;
  locale: string;
  mailBrand?: MailBrand;
  children: ReactNode;
}) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const brand = mailBrand?.brand ?? buildBrand;
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={preview}
      kicker={t("tasks.kicker")}
      heading={heading}
      footerNote={t("tasks.footer", { brand: brand.name })}
      showSettingsLink
    >
      {children}
    </EmailShell>
  );
}

/** Opgave-notifikationer (dagsoversigt, frister, ugeoversigt m.m.). */
export function TaskNotificationEmail(props: TaskNotificationEmailProps) {
  const locale = props.locale ?? "da";
  const { mailBrand } = props;
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const hello = (
    <Text style={emailText}>
      {props.name ? t("greeting", { name: props.name }) : t("greetingFallback")}
    </Text>
  );
  switch (props.kind) {
    case "daily_digest":
      return (
        <Shell
          mailBrand={mailBrand}
          locale={locale}
          preview={t("tasks.dailyPreview", { count: props.tasksToday.length })}
          heading={t("tasks.dailyHeading", { date: props.dateLabel })}
        >
          {hello}
          {props.overdueCount > 0 && (
            <EmailCallout tone="danger">
              {t("tasks.overdueCallout", { count: props.overdueCount })}
            </EmailCallout>
          )}
          {props.tasksToday.length > 0 ? (
            props.tasksToday.map((task) => (
              <TaskRow key={task.title} task={task} locale={locale} />
            ))
          ) : (
            <Text style={emailText}>{t("tasks.noneToday")}</Text>
          )}
          <EmailStats
            stats={[
              {
                label: t("tasks.completedYesterday"),
                value: String(props.completedYesterday),
              },
              {
                label: t("tasks.plannedToday"),
                value: String(props.tasksToday.length),
              },
            ]}
          />
          <EmailButton href={props.tasksUrl}>{t("tasks.seeAll")}</EmailButton>
        </Shell>
      );
    case "deadline_reminder":
      return (
        <Shell
          mailBrand={mailBrand}
          locale={locale}
          preview={t("tasks.deadlinePreview", {
            title: props.task?.title ?? t("tasks.aTask"),
          })}
          heading={t("tasks.deadlineHeading")}
        >
          {hello}
          <TaskRow
            task={
              props.task ?? {
                title: t("tasks.fallbackTask"),
                deadline: t("tasks.fallbackDeadline"),
              }
            }
            tone="soon"
            locale={locale}
          />
          <EmailButton href={props.tasksUrl}>{t("tasks.seeTask")}</EmailButton>
        </Shell>
      );
    case "overdue_alert":
      return (
        <Shell
          mailBrand={mailBrand}
          locale={locale}
          preview={t("tasks.overduePreview", { count: props.tasks.length })}
          heading={t("tasks.overdueHeading")}
        >
          {hello}
          <Text style={emailText}>{t("tasks.overdueIntro")}</Text>
          {props.tasks.map((task) => (
            <TaskRow key={task.title} task={task} tone="late" locale={locale} />
          ))}
          <EmailButton href={props.tasksUrl}>{t("tasks.seeTasks")}</EmailButton>
        </Shell>
      );
    case "weekly_review":
      return (
        <Shell
          mailBrand={mailBrand}
          locale={locale}
          preview={t("tasks.weeklyPreview", { brand: brand.name })}
          heading={t("tasks.weeklyHeading")}
        >
          {hello}
          <EmailStats
            stats={[
              {
                label: t("tasks.weeklyDone"),
                value: String(props.tasksCompleted),
              },
              {
                label: t("tasks.weeklyHours"),
                value: props.hoursTracked.toLocaleString(toIntlLocale(locale)),
              },
              {
                label: t("tasks.weeklyNew"),
                value: String(props.tasksCreated),
              },
            ]}
          />
          <EmailButton href={props.dashboardUrl}>
            {t("tasks.openApp", { brand: brand.name })}
          </EmailButton>
        </Shell>
      );
    case "ai_suggestion":
      return (
        <Shell
          mailBrand={mailBrand}
          locale={locale}
          preview={t("tasks.aiPreview")}
          heading={t("tasks.aiHeading")}
        >
          {hello}
          <EmailCallout>{props.suggestion}</EmailCallout>
          <EmailButton href={props.tasksUrl}>{t("tasks.seeTasks")}</EmailButton>
        </Shell>
      );
    default:
      return (
        <Shell
          mailBrand={mailBrand}
          locale={locale}
          preview={props.message.slice(0, 90)}
          heading={t("tasks.generalHeading", { brand: brand.name })}
        >
          {hello}
          <Text style={emailText}>{props.message}</Text>
          {props.url && (
            <EmailButton href={props.url}>{t("tasks.more")}</EmailButton>
          )}
        </Shell>
      );
  }
}

export default TaskNotificationEmail;
