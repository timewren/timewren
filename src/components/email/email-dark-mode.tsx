import { MAIL_DARK } from "./brand";

/**
 * Mørk tilstand for TimeTracks mails (EmailShell + PersonalEmailLayout).
 *
 * Mailene er designet lyse med faste farver. Klienter der læser
 * `prefers-color-scheme` (Apple Mail, iOS Mail, Outlook.com) får her den
 * mørke palet fra tokens via klasse-hooks; Outlook Android får de samme
 * regler under `[data-ogsc]`/`[data-ogsb]`. Gmail ignorerer det og viser
 * enten den lyse version eller inverterer selv; de faste farver er valgt,
 * så begge dele kan læses.
 */
const D = MAIL_DARK;

/** Farve-regler (forgrund): `p` er tom eller `[data-ogsc] `. */
function colorRules(p: string) {
  return [
    `${p}.tt-card h1, ${p}.tt-card h2, ${p}.tt-card strong { color: ${D.text} !important; }`,
    `${p}.tt-card p, ${p}.tt-card td, ${p}.tt-card th, ${p}.tt-card div, ${p}.tt-card li { color: ${D.text} !important; }`,
    `${p}.tt-card .tt-kv-label, ${p}.tt-card .tt-muted, ${p}.tt-footer p, ${p}.tt-header .tt-muted { color: ${D.muted} !important; }`,
    `${p}.tt-card .tt-kv-value { color: ${D.text} !important; }`,
    // Brødtekst-links bliver lyse; knapper (links med baggrund) har egne regler.
    `${p}.tt-card a:not([style*="background"]), ${p}.tt-footer a { color: ${D.brand} !important; }`,
    `${p}.tt-header .tt-wordmark { color: ${D.text} !important; }`,
    `${p}.tt-card a.tt-btn { color: ${D.onBrand} !important; }`,
    `${p}.tt-card a.tt-btn-secondary { color: ${D.text} !important; }`,
  ];
}

/** Baggrunds-regler: `p` er tom eller `[data-ogsb] `. */
function backgroundRules(p: string) {
  return [
    `${p}.tt-body, ${p}.tt-body > table > tbody > tr > td, ${p}.tt-page { background-color: ${D.page} !important; }`,
    `${p}.tt-card { background-color: ${D.card} !important; }`,
    // Lyse flader i kortet (callouts, nøgletal, kodebokse) bliver hævede
    // mørke flader. Knapper og klippekortets huller har egne regler.
    `${p}.tt-card table[style*="background"]:not(.tt-keep), ${p}.tt-card td[style*="background"]:not(.tt-btn-td):not(.tt-hul), ${p}.tt-card div[style*="background"], ${p}.tt-card p[style*="background"] { background-color: ${D.surface} !important; }`,
    `${p}.tt-card td.tt-btn-td, ${p}.tt-card a.tt-btn { background-color: ${D.brand} !important; }`,
    `${p}.tt-card td.tt-btn-td-secondary, ${p}.tt-card a.tt-btn-secondary { background-color: transparent !important; border-color: ${D.edge} !important; }`,
    `${p}.tt-card td.tt-hul-brugt { background-color: ${D.brand} !important; border-color: ${D.brand} !important; }`,
    `${p}.tt-card td.tt-hul-halv { background-color: ${D.brandLight} !important; border-color: ${D.brand} !important; }`,
    `${p}.tt-card td.tt-hul-tom { background-color: transparent !important; border-color: ${D.brand} !important; }`,
    `${p}.tt-card td, ${p}.tt-card th, ${p}.tt-card hr, ${p}.tt-card { border-color: ${D.line} !important; }`,
  ];
}

export const emailDarkModeCss = [
  ":root { color-scheme: light dark; supported-color-schemes: light dark; }",
  "@media (prefers-color-scheme: dark) {",
  ...colorRules(""),
  ...backgroundRules(""),
  "}",
  ...colorRules("[data-ogsc] "),
  ...backgroundRules("[data-ogsb] "),
].join("\n");

/** Meta-tags + stylesheet til `<Head>`. */
export function EmailDarkModeHead() {
  return (
    <>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      <meta name="x-apple-disable-message-reformatting" />
      <meta
        name="format-detection"
        content="telephone=no, date=no, address=no, email=no"
      />
      <style>{emailDarkModeCss}</style>
    </>
  );
}
