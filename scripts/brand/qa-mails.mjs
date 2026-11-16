/**
 * Tjekker renderede mails (fra mail-previews.preview.tsx) mod BRAND.md.
 *
 *   node scripts/brand/qa-mails.mjs <html-mappe>
 *
 * Fejl: tankestreger, "klient", vi/os/vores, udråbstegn i preview, emne og
 * overskrift, emoji, midterpunktummer, gamle blå farver, gammelt logo og
 * avatar fra mahoje.dk, og HTML over Gmails klip-grænse (102 KB).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const OLD_COLORS = /#(2563eb|3b82f6|1d4ed8|1e3a8a|eff6ff|dbeafe)\b/i;
let problems = 0;

function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#xA0;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(dir, file), "utf8");
  const id = file.replace(/\.html$/, "");
  const text = visibleText(html);
  const out = [];
  const subjectFile = join(dir, `${id}.subject.txt`);
  let subject = "";
  try {
    subject = readFileSync(subjectFile, "utf8");
  } catch {}
  const preview =
    html.match(/<div[^>]*display:none[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";

  if (/[—–]/.test(text) || / - /.test(text)) out.push("tankestreg");
  if (/\bklient/i.test(text)) out.push("klient");
  if (/\b(vi|os|vores)\b/i.test(text)) {
    const m = text.match(/.{0,30}\b(vi|os|vores)\b.{0,30}/i);
    out.push(`vi/os: "${m?.[0]}"`);
  }
  if (/!/.test(visibleText(preview)) || /!/.test(subject) || /!/.test(h1))
    out.push("udråbstegn i preview/emne/overskrift");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text)) out.push("emoji");
  if (/ · /.test(text)) out.push("midterpunktum");
  if (OLD_COLORS.test(html)) out.push("gammel blå");
  if (/apple-touch-icon|mahoje\.dk\/_next/.test(html))
    out.push("gammelt logo/avatar");
  if (html.length > 102_000) out.push(`for stor (${html.length} B)`);
  if (out.length) {
    problems += out.length;
    console.log(`${id}: ${out.join("; ")}`);
  }
}
console.log(problems === 0 ? "QA: ingen fund" : `QA: ${problems} fund`);
process.exit(problems === 0 ? 0 : 1);
