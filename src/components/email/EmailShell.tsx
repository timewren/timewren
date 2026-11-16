import {
  Body,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { CSSProperties, ReactNode } from "react";
import { EmailDarkModeHead } from "@/components/email/email-dark-mode";
import {
  type HulTilstand,
  klippekortModel,
} from "@/components/klippekort/huller-model";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand } from "@/lib/brand";
import { marketingUrl } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  bgAttr,
  MAIL,
  MAIL_APP_URL,
  MAIL_BUTTON_RADIUS,
  MAIL_FONT,
  MAIL_FONT_MONO,
  MAIL_LOGO_URL,
  MAIL_RADIUS,
  MAIL_STATUS,
  MAIL_WIDTH,
} from "./brand";

interface EmailShellProps {
  /** Forhåndsvisningsteksten i indbakken */
  preview: string;
  /** Overskrift øverst i indholdet */
  heading?: string;
  /** Kort linje til højre for logoet, fx "Klippekort" eller "Sikkerhed" */
  kicker?: string;
  /** Linje i bunden: hvorfor modtageren får mailen */
  footerNote?: string;
  /** Vis link til notifikationsindstillinger (kun for brugere, ikke kunder) */
  showSettingsLink?: boolean;
  /** Afsenderens eget logo/navn, når mailen sendes på en kundes vegne */
  brandLogoUrl?: string | null;
  brandName?: string | null;
  /**
   * "kunde": mailen går til brugerens kunde (fx godkendelse i kundeportalen).
   * Så er sidefoden neutral: ingen kontolinje, intet link til indstillinger
   * og ingen firmalinje, kun "Sendt via TimeTrack".
   */
  audience?: "bruger" | "kunde";
  /** Modtagerens sprog (standard "da") */
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
  children: ReactNode;
}

const presentation = {
  role: "presentation",
  border: 0,
  cellPadding: 0,
  cellSpacing: 0,
} as const;

/**
 * Ydre ramme fælles for begge mail-lag: lys side, ét hvidt kort på maks.
 * 600 px, tabeller hele vejen (Outlook) og mørk tilstand via klasse-hooks.
 */
export function MailFrame({
  preview,
  header,
  footer,
  children,
  locale = "da",
}: {
  locale?: string;
  preview: string;
  header?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <Html lang={locale}>
      <Head>
        <EmailDarkModeHead />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        className="tt-body"
        style={{
          backgroundColor: MAIL.page,
          fontFamily: MAIL_FONT,
          margin: 0,
          padding: 0,
        }}
      >
        <table
          {...presentation}
          width="100%"
          className="tt-page"
          bgcolor={MAIL.page}
          style={{ backgroundColor: MAIL.page }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  {...presentation}
                  width="100%"
                  style={{ maxWidth: `${MAIL_WIDTH}px`, margin: "0 auto" }}
                >
                  <tbody>
                    {header && (
                      <tr>
                        <td
                          className="tt-header"
                          data-skip-in-text="true"
                          style={{ padding: "0 4px 16px" }}
                        >
                          {header}
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td
                        className="tt-card"
                        {...bgAttr(MAIL.card)}
                        style={{
                          backgroundColor: MAIL.card,
                          border: `1px solid ${MAIL.line}`,
                          borderRadius: MAIL_RADIUS,
                          color: MAIL.text,
                          fontFamily: MAIL_FONT,
                          padding: "32px 28px",
                        }}
                      >
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className="tt-footer"
                        style={{ padding: "16px 4px 0" }}
                      >
                        {footer}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </Body>
    </Html>
  );
}

/**
 * Fælles ramme for TimeTracks systemmails (kvittering, nulstil adgangskode,
 * invitation, saldo, advarsler): logo og ordmærke, ét indholdskort og en
 * rolig sidefod. Mails fra Mads selv bruger PersonalEmailLayout.
 */
export function EmailShell({
  preview,
  heading,
  kicker,
  footerNote,
  showSettingsLink = false,
  brandLogoUrl,
  brandName,
  audience = "bruger",
  locale = "da",
  mailBrand,
  children,
}: EmailShellProps) {
  const b = mailBrand?.brand ?? brand;
  const t = mailT("emails", locale, mailBrand?.key);
  const logoUrl = mailBrand?.logoUrl ?? MAIL_LOGO_URL;
  const appUrl = mailBrand?.appUrl ?? MAIL_APP_URL;
  const siteUrl = mailBrand?.siteUrl ?? marketingUrl();
  const name = brandName || b.name;
  const header = (
    <table {...presentation} width="100%">
      <tbody>
        <tr>
          <td style={{ verticalAlign: "middle" }}>
            {brandLogoUrl ? (
              <Img
                src={brandLogoUrl}
                height="32"
                alt={name}
                style={{
                  border: 0,
                  display: "block",
                  height: "32px",
                  maxWidth: "180px",
                  width: "auto",
                }}
              />
            ) : (
              <a
                href={appUrl}
                style={{ color: MAIL.text, textDecoration: "none" }}
              >
                <Img
                  src={logoUrl}
                  width="32"
                  height="32"
                  alt=""
                  style={{
                    border: 0,
                    display: "inline-block",
                    height: "32px",
                    verticalAlign: "middle",
                    width: "32px",
                  }}
                />
                <span
                  className="tt-wordmark"
                  style={{
                    color: MAIL.text,
                    fontFamily: MAIL_FONT,
                    fontSize: "18px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: "32px",
                    paddingLeft: "10px",
                    verticalAlign: "middle",
                  }}
                >
                  {b.name}
                </span>
              </a>
            )}
          </td>
          {kicker && (
            <td
              align="right"
              className="tt-muted"
              style={{
                color: MAIL.muted,
                fontFamily: MAIL_FONT,
                fontSize: "13px",
                lineHeight: "32px",
                verticalAlign: "middle",
              }}
            >
              {kicker}
            </td>
          )}
        </tr>
      </tbody>
    </table>
  );

  const footer =
    audience === "kunde" ? (
      <>
        {footerNote && <Text style={footerText}>{footerNote}</Text>}
        <Text style={footerText}>
          {t("shell.sentVia")}{" "}
          <Link href={siteUrl} style={footerLink}>
            {b.name}
          </Link>
        </Text>
      </>
    ) : (
      <>
        <Text style={footerText}>
          {footerNote ?? t("shell.accountNote", { brand: b.name })}
          {showSettingsLink && (
            <>
              {" "}
              <Link
                href={`${appUrl}/dashboard/settings/notifications`}
                style={footerLink}
              >
                {t("shell.mailSettings")}
              </Link>
            </>
          )}
        </Text>
        <Text style={footerText}>
          <Link href={siteUrl} style={footerLink}>
            {b.name}
          </Link>{" "}
          {b.id === "timetrack"
            ? t("shell.madeBy")
            : t("shell.openSource", { owner: b.legalOwner })}
        </Text>
      </>
    );

  return (
    <MailFrame
      preview={preview}
      header={header}
      footer={footer}
      locale={locale}
    >
      {heading && <EmailHeading>{heading}</EmailHeading>}
      {children}
    </MailFrame>
  );
}

// ─── Byggeklodser til indholdet ──────────────────────────────────────

export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        color: MAIL.text,
        fontFamily: MAIL_FONT,
        fontSize: "24px",
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: "30px",
        margin: "0 0 16px 0",
      }}
    >
      {children}
    </h1>
  );
}

export const emailText = {
  color: MAIL.text,
  fontFamily: MAIL_FONT,
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px 0",
};

export const emailMuted = {
  color: MAIL.muted,
  fontFamily: MAIL_FONT,
  fontSize: "14px",
  lineHeight: "20px",
  margin: "16px 0 0 0",
};

export const emailLink = {
  color: MAIL.brand,
  textDecoration: "underline",
};

const footerText = {
  color: MAIL.muted,
  fontFamily: MAIL_FONT,
  fontSize: "12px",
  lineHeight: "18px",
  margin: "0 0 4px 0",
};

const footerLink = {
  color: MAIL.muted,
  textDecoration: "underline",
};

/**
 * Primær handling, én pr. mail. Bulletproof: tabelcelle med `bgcolor`, så
 * knappen også har farve i Outlook, og linket fylder hele cellen.
 */
export function EmailButton({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  const primary = variant === "primary";
  const bg = primary ? MAIL.brand : MAIL.card;
  const linkStyle: CSSProperties = {
    backgroundColor: bg,
    border: primary ? `1px solid ${MAIL.brand}` : `1px solid ${MAIL.edge}`,
    borderRadius: MAIL_BUTTON_RADIUS,
    color: primary ? MAIL.onBrand : MAIL.text,
    display: "inline-block",
    fontFamily: MAIL_FONT,
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "20px",
    padding: "13px 22px",
    textDecoration: "none",
  };
  return (
    <table {...presentation} style={{ margin: "8px 0 24px" }}>
      <tbody>
        <tr>
          <td
            className={primary ? "tt-btn-td" : "tt-btn-td-secondary"}
            {...bgAttr(bg)}
            style={{ backgroundColor: bg, borderRadius: MAIL_BUTTON_RADIUS }}
          >
            <a
              href={href}
              className={primary ? "tt-btn" : "tt-btn-secondary"}
              style={linkStyle}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Informationsboks: neutral (info), advarsel, fare eller bekræftelse. */
export function EmailCallout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const t = MAIL_STATUS[tone];
  return (
    <table {...presentation} width="100%" style={{ margin: "16px 0" }}>
      <tbody>
        <tr>
          <td
            {...bgAttr(t.bg)}
            style={{
              backgroundColor: t.bg,
              borderLeft: `3px solid ${t.border}`,
              borderRadius: "6px",
              color: t.text,
              fontFamily: MAIL_FONT,
              fontSize: "15px",
              lineHeight: "22px",
              padding: "12px 16px",
            }}
          >
            {title && (
              <p
                style={{
                  color: t.text,
                  fontSize: "15px",
                  fontWeight: 700,
                  margin: "0 0 4px 0",
                }}
              >
                {title}
              </p>
            )}
            {children}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Nøgle/værdi-rækker: fakturadetaljer, klippekort-status m.m. */
export function EmailKeyValue({
  rows,
}: {
  rows: { label: string; value: ReactNode; strong?: boolean }[];
}) {
  return (
    <table
      {...presentation}
      width="100%"
      style={{ borderCollapse: "collapse", margin: "8px 0 16px" }}
    >
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="tt-kv-row">
            <td
              className="tt-kv-label"
              style={{
                borderBottom: `1px solid ${MAIL.line}`,
                color: MAIL.muted,
                fontFamily: MAIL_FONT,
                fontSize: "15px",
                padding: "9px 0",
                width: "40%",
              }}
            >
              {row.label}
            </td>
            <td
              className="tt-kv-value"
              style={{
                borderBottom: `1px solid ${MAIL.line}`,
                color: MAIL.text,
                fontFamily: MAIL_FONT,
                fontSize: row.strong ? "17px" : "15px",
                fontVariantNumeric: "tabular-nums",
                fontWeight: row.strong ? 700 : 500,
                padding: "9px 0",
                textAlign: "right",
              }}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Op til tre nøgletal side om side (ugeopsummering). */
export function EmailStats({
  stats,
}: {
  stats: { label: string; value: string; sub?: string; subColor?: string }[];
}) {
  return (
    <table
      {...presentation}
      width="100%"
      style={{ borderCollapse: "separate", margin: "8px 0 16px" }}
    >
      <tbody>
        <tr>
          {stats.map((s, i) => [
            i > 0 ? (
              <td key={`${s.label}-gap`} width="8" style={{ width: "8px" }} />
            ) : null,
            <td
              key={s.label}
              {...bgAttr(MAIL.surface)}
              style={{
                backgroundColor: MAIL.surface,
                borderRadius: "8px",
                fontFamily: MAIL_FONT,
                padding: "14px 14px",
                verticalAlign: "top",
                width: `${Math.floor(100 / stats.length)}%`,
              }}
            >
              <p
                className="tt-muted"
                style={{
                  color: MAIL.muted,
                  fontSize: "13px",
                  lineHeight: "18px",
                  margin: "0 0 4px 0",
                }}
              >
                {s.label}
              </p>
              <p
                style={{
                  color: MAIL.text,
                  fontSize: "22px",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  lineHeight: "28px",
                  margin: 0,
                }}
              >
                {s.value}
              </p>
              {s.sub && (
                <p
                  style={{
                    color: s.subColor ?? MAIL.muted,
                    fontSize: "13px",
                    lineHeight: "18px",
                    margin: "4px 0 0 0",
                  }}
                >
                  {s.sub}
                </p>
              )}
            </td>,
          ])}
        </tr>
      </tbody>
    </table>
  );
}

/** Reservelink under en knap, når mailklienten ikke vil klikke. */
export function EmailFallbackLink({
  href,
  locale = "da",
}: {
  href: string;
  locale?: string;
}) {
  return (
    <>
      <Text style={emailMuted}>
        {mailT("emails", locale)("shell.fallbackLink")}
      </Text>
      <Text
        className="tt-code"
        style={{
          backgroundColor: MAIL.surface,
          borderRadius: "6px",
          color: MAIL.text,
          fontFamily: MAIL_FONT_MONO,
          fontSize: "12px",
          lineHeight: "18px",
          margin: "6px 0 0 0",
          padding: "10px 12px",
          wordBreak: "break-all",
        }}
      >
        {href}
      </Text>
    </>
  );
}

const HUL_PX = 14;
const HULLER_PR_RAEKKE = 10;

const hulStyle: Record<HulTilstand, { bg: string; className: string }> = {
  brugt: { bg: MAIL.brand, className: "tt-hul tt-hul-brugt" },
  halv: { bg: MAIL.brandLight, className: "tt-hul tt-hul-halv" },
  tom: { bg: MAIL.card, className: "tt-hul tt-hul-tom" },
};

/**
 * Klippekortet i mails (BRAND.md → Klippekortet: regler): huller som
 * tabelceller i rækker af 10, så kortet kan være på en telefon. Brugte
 * timer er udfyldte, en rest under et helt hul er lysegrøn, og saldoen
 * står som det, der er tilbage. Store kort falder tilbage til en bjælke.
 */
export function EmailKlippekort({
  totalHours,
  remainingHours,
  name,
  locale = "da",
}: {
  totalHours: number;
  remainingHours: number;
  name?: string;
  locale?: string;
}) {
  const t = mailT("emails", locale);
  const m = klippekortModel(totalHours, remainingHours);
  const nf = new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 2,
  });
  const label =
    m.overdraftHours > 0
      ? t("shell.klippekortLabelOverdraft", {
          remaining: nf.format(m.remainingHours),
          total: nf.format(m.totalHours),
          overdraft: nf.format(m.overdraftHours),
        })
      : t("shell.klippekortLabel", {
          remaining: nf.format(m.remainingHours),
          total: nf.format(m.totalHours),
        });
  const note = m.note
    ? t("shell.klippekortNote", { hours: m.hoursPerHole })
    : null;
  const rows: HulTilstand[][] = [];
  for (let i = 0; i < m.holes.length; i += HULLER_PR_RAEKKE) {
    rows.push(m.holes.slice(i, i + HULLER_PR_RAEKKE));
  }
  return (
    <table
      {...presentation}
      width="100%"
      className="tt-keep"
      style={{
        border: `1px solid ${MAIL.line}`,
        borderRadius: "8px",
        margin: "8px 0 20px",
      }}
    >
      <tbody>
        <tr>
          <td style={{ fontFamily: MAIL_FONT, padding: "16px 16px 14px" }}>
            {name && (
              <p
                className="tt-muted"
                style={{
                  color: MAIL.muted,
                  fontSize: "14px",
                  lineHeight: "20px",
                  margin: "0 0 4px 0",
                }}
              >
                {name}
              </p>
            )}
            <p
              style={{
                color: MAIL.text,
                fontSize: "20px",
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
                lineHeight: "26px",
                margin: "0 0 12px 0",
              }}
            >
              {label}
            </p>
            {m.useBar ? (
              <table {...presentation} width="100%">
                <tbody>
                  <tr>
                    <td
                      className="tt-hul tt-hul-brugt"
                      {...bgAttr(MAIL.brand)}
                      width={`${Math.round(m.usedFraction * 100)}%`}
                      style={{ backgroundColor: MAIL.brand, height: "10px" }}
                    />
                    <td
                      className="tt-hul tt-hul-halv"
                      {...bgAttr(MAIL.brandLight)}
                      style={{
                        backgroundColor: MAIL.brandLight,
                        height: "10px",
                      }}
                    />
                  </tr>
                </tbody>
              </table>
            ) : (
              <table
                {...presentation}
                aria-hidden="true"
                style={{ borderCollapse: "separate", borderSpacing: "5px" }}
              >
                <tbody>
                  {rows.map((row, r) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rækkerne har ingen identitet ud over rækkefølgen
                    <tr key={r}>
                      {row.map((hul, h) => (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: hullerne har ingen identitet ud over rækkefølgen
                          key={h}
                          className={hulStyle[hul].className}
                          {...bgAttr(hulStyle[hul].bg)}
                          width={HUL_PX}
                          height={HUL_PX}
                          style={{
                            backgroundColor: hulStyle[hul].bg,
                            border: `2px solid ${MAIL.brand}`,
                            borderRadius: "50%",
                            fontSize: "1px",
                            height: `${HUL_PX}px`,
                            lineHeight: "1px",
                            width: `${HUL_PX}px`,
                          }}
                        >
                          &nbsp;
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {note && (
              <p
                className="tt-muted"
                style={{
                  color: MAIL.muted,
                  fontSize: "13px",
                  lineHeight: "18px",
                  margin: "8px 0 0 0",
                }}
              >
                {note}
              </p>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export const emailDivider = {
  borderColor: MAIL.line,
  margin: "20px 0",
};

export { Hr as EmailHr };
