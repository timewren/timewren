#!/usr/bin/env node
// Laver latest.json (Tauri-updaterens format) og RELEASE_NOTES.md for en
// TimeTrack-release ud fra filerne i release-mappen.
//
//   node scripts/release-manifest.mjs <release-mappe> <version> <base-url> [pub-date]
//
// Kræver alle tre platforme med .sig, så ingen brugere står uden opdatering:
//   windows-x86_64  TimeTrack_<v>_x64-setup.exe (+ .sig)
//   darwin-aarch64  darwin-aarch64-TimeTrack.app.tar.gz (+ .sig)
//   darwin-x86_64   darwin-x86_64-TimeTrack.app.tar.gz (+ .sig)
// Noterne er afsnittet "## [<version>]" i CHANGELOG.md. Ligger der en fil
// windows-signing.txt med "unsigned" i release-mappen, får release-noterne
// (ikke latest.json) en tydelig advarsel om den usignerede Windows-installer.
import fs from "node:fs";
import path from "node:path";

const [dir, version, base, pubDate = new Date().toISOString().replace(/\.\d+Z$/, "Z")] =
  process.argv.slice(2);
if (!dir || !version || !base) {
  console.error("Brug: release-manifest.mjs <release-mappe> <version> <base-url> [pub-date]");
  process.exit(2);
}

function changelogNotes(v) {
  try {
    const log = fs.readFileSync("CHANGELOG.md", "utf8");
    const re = new RegExp(
      "^## \\[" + v.replace(/\./g, "\\.") + "\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|$(?![\\s\\S]))",
      "m",
    );
    const m = log.match(re);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const notes = changelogNotes(version) || "TimeTrack " + version;
const files = fs.readdirSync(dir);
const platforms = {};
const missing = [];
function add(platform, match) {
  const asset = files.find((f) => match(f) && !f.endsWith(".sig"));
  const sig = asset && files.find((f) => f === asset + ".sig");
  if (!asset || !sig) {
    missing.push(`${platform} (${asset ? "mangler .sig" : "mangler pakke"})`);
    return;
  }
  platforms[platform] = {
    signature: fs.readFileSync(path.join(dir, sig), "utf8").trim(),
    url: base + "/" + encodeURIComponent(asset),
  };
}
add("windows-x86_64", (f) => f === `TimeTrack_${version}_x64-setup.exe`);
add("darwin-aarch64", (f) => f === "darwin-aarch64-TimeTrack.app.tar.gz");
add("darwin-x86_64", (f) => f === "darwin-x86_64-TimeTrack.app.tar.gz");
if (missing.length) {
  console.error("Kan ikke udgive, platforme mangler: " + missing.join(", "));
  process.exit(1);
}

const manifest = { version, notes, pub_date: pubDate, platforms };
fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n");

let body = notes;
const signing = path.join(dir, "windows-signing.txt");
if (fs.existsSync(signing)) {
  if (fs.readFileSync(signing, "utf8").trim() === "unsigned") {
    body =
      "> **Windows-installeren er ikke kodesigneret.** Windows SmartScreen viser \"Windows beskyttede din pc\". " +
      "Vælg \"Flere oplysninger\" og \"Kør alligevel\". Opdateringer inde i appen er stadig signeret og tjekket.\n\n" +
      body;
  }
  fs.rmSync(signing);
}
fs.writeFileSync(path.join(dir, "RELEASE_NOTES.md"), body + "\n");
console.log(JSON.stringify(manifest, null, 2));
