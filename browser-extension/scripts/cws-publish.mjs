/**
 * Upload (og evt. udgiv) en pakket Chrome-zip til Chrome Web Store via
 * Chrome Web Store API v1.1. Bruges af .github/workflows/extension-publish.yml.
 *
 *   node scripts/cws-publish.mjs <zip> [--publish] [--target=default|trustedTesters]
 *
 * Kræver env: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN,
 * CWS_EXTENSION_ID. Ingen npm-afhængigheder — kun Node 22's fetch.
 *
 * Skriver `status=<...>` (og `uploaded=true` efter en vellykket upload) til
 * $GITHUB_OUTPUT, så workflowet kan melde resultatet
 * til Discord. Secrets og access token logges aldrig; tokenet maskeres med
 * ::add-mask:: i tilfælde af at et fejlsvar skulle gentage det.
 */
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith("--"));
const publish = args.includes("--publish");
const target =
  args.find((a) => a.startsWith("--target="))?.split("=")[1] ?? "default";

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

function fail(message, status = "FAILED") {
  console.error(`::error::${message}`);
  setOutput("status", status);
  process.exit(1);
}

if (!zipPath) fail("Brug: node scripts/cws-publish.mjs <zip> [--publish]");
if (!["default", "trustedTesters"].includes(target)) {
  fail(`Ukendt target "${target}" (forventede default eller trustedTesters)`);
}

const required = [
  "CWS_CLIENT_ID",
  "CWS_CLIENT_SECRET",
  "CWS_REFRESH_TOKEN",
  "CWS_EXTENSION_ID",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  fail(
    `Mangler secrets: ${missing.join(", ")} — se browser-extension/RELEASE.md`,
  );
}

const {
  CWS_CLIENT_ID,
  CWS_CLIENT_SECRET,
  CWS_REFRESH_TOKEN,
  CWS_EXTENSION_ID,
} = process.env;

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

// Hvilket trin vi er nået til, så en netværksfejl (fetch kaster) meldes med
// det rigtige trin — fx at uploaden lykkedes, men publish fejlede.
let stage = "AUTH";
process.on("uncaughtException", (err) => {
  fail(`${stage}: ${err?.message ?? err}`, `${stage}_FAILED`);
});
process.on("unhandledRejection", (err) => {
  fail(`${stage}: ${err?.message ?? err}`, `${stage}_FAILED`);
});

// 1) Refresh token → access token
const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: CWS_CLIENT_ID,
    client_secret: CWS_CLIENT_SECRET,
    refresh_token: CWS_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
const tokenBody = await readJson(tokenRes);
if (!tokenRes.ok || !tokenBody.access_token) {
  // Kun fejlkoden — svaret kan ikke indeholde vores secrets, men vi logger
  // alligevel kun de kendte felter.
  fail(
    `Token-udveksling fejlede (HTTP ${tokenRes.status}): ${tokenBody.error ?? "ukendt"} ${tokenBody.error_description ?? ""}`.trim(),
    "AUTH_FAILED",
  );
}
const accessToken = tokenBody.access_token;
console.log(`::add-mask::${accessToken}`);

const authHeaders = {
  Authorization: `Bearer ${accessToken}`,
  "x-goog-api-version": "2",
};

// 2) Upload zip
stage = "UPLOAD";
const zip = readFileSync(zipPath);
console.log(
  `Uploader ${zipPath} (${zip.length} bytes) til ${CWS_EXTENSION_ID}…`,
);
const uploadRes = await fetch(
  `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}`,
  {
    method: "PUT",
    headers: { ...authHeaders, "Content-Type": "application/zip" },
    body: zip,
  },
);
const uploadBody = await readJson(uploadRes);
if (!uploadRes.ok || uploadBody.uploadState !== "SUCCESS") {
  console.error(JSON.stringify(uploadBody.itemError ?? uploadBody, null, 2));
  fail(
    `Upload fejlede (HTTP ${uploadRes.status}, uploadState=${uploadBody.uploadState ?? "ukendt"})`,
    "UPLOAD_FAILED",
  );
}
console.log("Upload OK (uploadState=SUCCESS)");
setOutput("uploaded", "true");

if (!publish) {
  console.log(
    "Udgiver ikke (publish=false) — udkastet ligger klar i dashboardet.",
  );
  setOutput("status", "UPLOADED");
  process.exit(0);
}

// 3) Publish
stage = "PUBLISH";
const publishRes = await fetch(
  `https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}/publish?publishTarget=${target}`,
  { method: "POST", headers: { ...authHeaders, "Content-Length": "0" } },
);
const publishBody = await readJson(publishRes);
const statuses = Array.isArray(publishBody.status) ? publishBody.status : [];
const okStatus = statuses.find(
  (s) => s === "OK" || s === "ITEM_PENDING_REVIEW",
);
if (!publishRes.ok || !okStatus) {
  console.error(
    JSON.stringify(
      { status: publishBody.status, statusDetail: publishBody.statusDetail },
      null,
      2,
    ),
  );
  fail(
    `Publish fejlede (HTTP ${publishRes.status}, status=${statuses.join(",") || "ukendt"})`,
    "PUBLISH_FAILED",
  );
}
console.log(`Publish OK (status=${statuses.join(",")}, target=${target})`);
setOutput("status", okStatus);
