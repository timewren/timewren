import { brand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import { EmailButton, EmailKeyValue, EmailShell } from "./EmailShell";

interface AdminNotificationEmailProps {
  eventTitle: string;
  rows: { label: string; value: string }[];
  userLink?: string;
  locale?: string;
}

/** Intern besked til admin om en hændelse (ny bruger, opsigelse m.m.). */
export function AdminNotificationEmail({
  eventTitle,
  rows,
  userLink,
  locale = "da",
}: AdminNotificationEmailProps) {
  const t = mailT("emailsReports", locale);
  return (
    <EmailShell
      locale={locale}
      preview={eventTitle}
      kicker={t("admin.kicker")}
      heading={eventTitle}
      footerNote={t("admin.footerNote", { brand: brand.name })}
    >
      <EmailKeyValue rows={rows} />
      {userLink && (
        <EmailButton href={userLink}>{t("admin.seeUser")}</EmailButton>
      )}
    </EmailShell>
  );
}

export default AdminNotificationEmail;
