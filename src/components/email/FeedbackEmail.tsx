import { Text } from "@react-email/components";
import { brand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import { bgAttr, MAIL, MAIL_FONT } from "./brand";
import { EmailShell, emailMuted, emailText } from "./EmailShell";
import { mailMarkup } from "./mail-markup";

const TYPE_KEYS: Record<string, string> = {
  feedback: "feedback.typeFeedback",
  feature: "feedback.typeFeature",
  bug: "feedback.typeBug",
};

export interface FeedbackEmailProps {
  type: "feedback" | "feature" | "bug";
  message: string;
  userName: string;
  userEmail: string;
  orgName?: string;
  planName?: string;
  context: {
    url: string;
    viewport: string;
    userAgent: string;
    appVersion: string;
    timer?: {
      isRunning: boolean;
      projectId: string | null;
      clientId: string | null;
      startTime: number | null;
    };
  };
  hasScreenshot: boolean;
  /** Rækkens uuid, det samme nummer som brugeren ser i bekræftelsen. */
  reportId?: string;
  /** Modtagerens (adminens) sprog */
  locale?: string;
}

const presentation = {
  role: "presentation",
  border: 0,
  cellPadding: 0,
  cellSpacing: 0,
} as const;

/** Indrammet tekst på en rolig flade: brugerens besked. */
function Box({ children }: { children: string }) {
  return (
    <table {...presentation} width="100%" style={{ margin: "12px 0" }}>
      <tbody>
        <tr>
          <td
            {...bgAttr(MAIL.surface)}
            style={{
              backgroundColor: MAIL.surface,
              borderRadius: "6px",
              color: MAIL.text,
              fontFamily: MAIL_FONT,
              fontSize: "15px",
              lineHeight: "22px",
              padding: "12px 16px",
              whiteSpace: "pre-wrap",
            }}
          >
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Intern mail til admin: en bruger har sendt feedback fra TimeTrack. */
export function FeedbackEmail({
  type,
  message,
  userName,
  userEmail,
  orgName,
  planName,
  context,
  hasScreenshot,
  reportId,
  locale = "da",
}: FeedbackEmailProps) {
  const t = mailT("emailsReports", locale);
  const label = TYPE_KEYS[type] ? t(TYPE_KEYS[type]) : type;
  const from = [orgName, planName].filter(Boolean).join(", ");
  return (
    <EmailShell
      locale={locale}
      preview={t("feedback.preview", { type: label, user: userName })}
      kicker={t("feedback.kicker")}
      heading={label}
      footerNote={t("feedback.footerNote", { brand: brand.name })}
    >
      <Text style={emailText}>
        {mailMarkup(
          t("feedback.from", {
            user: userName,
            email: userEmail,
            extra: from ? `, ${from}` : "",
          }),
        )}
      </Text>
      <Box>{message}</Box>
      <Text style={{ ...emailMuted, margin: "0 0 8px 0" }}>
        {t("feedback.page", { value: context.url })}
        <br />
        {t("feedback.viewport", { value: context.viewport })}
        <br />
        {t("feedback.appVersion", { value: context.appVersion })}
        <br />
        {t("feedback.browser", { value: context.userAgent })}
        {reportId ? (
          <>
            <br />
            {t("feedback.reportId", { value: reportId })}
          </>
        ) : null}
        {context.timer?.isRunning ? (
          <>
            <br />
            {t("feedback.timer", {
              project: context.timer.projectId ?? t("feedback.none"),
              client: context.timer.clientId ?? t("feedback.none"),
            })}
          </>
        ) : null}
      </Text>
      {/* Console og breadcrumbs står kun i DB (/admin/feedback), ikke i mailen */}
      {hasScreenshot && (
        <Text style={emailMuted}>{t("feedback.screenshot")}</Text>
      )}
    </EmailShell>
  );
}
