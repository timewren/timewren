/**
 * Package the built extension into store-ready zips.
 *
 * Run via `npm run package` (which builds chrome + firefox first). Produces:
 *   release/timetrack-extension-chrome-v<version>.zip
 *   release/timetrack-extension-firefox-v<version>.zip
 *
 * The zip contains the *contents* of the build dir, so manifest.json sits at
 * the archive root as the Chrome Web Store / AMO require.
 *
 * Windows-note (15/9-2026): PowerShells `Compress-Archive` skriver stierne
 * med BACKSLASH i zip-kataloget. ZIP-specen (APPNOTE 4.4.17.1) kræver
 * forward slash, og butikkerne læser derfor "assets\popup.css" som ét
 * filnavn i stedet for en mappe — uploaden bliver afvist eller extensionen
 * går i stykker. Vi bruger i stedet Windows' indbyggede bsdtar
 * (System32\tar.exe, findes fra Win10 17063), som skriver korrekte stier.
 * Hver zip verificeres til sidst, så en ødelagt pakke aldrig når butikken.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { platform } from "node:process";

const version = process.env.npm_package_version ?? "dev";
const outDir = "release";
mkdirSync(outDir, { recursive: true });

const targets = [
  { dir: "dist", zip: `${outDir}/timetrack-extension-chrome-v${version}.zip` },
  {
    dir: "dist-firefox",
    zip: `${outDir}/timetrack-extension-firefox-v${version}.zip`,
  },
];

/**
 * Filnavnene fra zippens central directory. Parser kun det nødvendige:
 * hver post starter med PK\x01\x02, navnelængden står på offset 28 og selve
 * navnet på offset 46.
 */
function zipEntryNames(zipPath) {
  const buf = readFileSync(zipPath);
  const names = [];
  const SIG = 0x02014b50;
  for (let i = 0; i + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== SIG) continue;
    const nameLen = buf.readUInt16LE(i + 28);
    names.push(buf.toString("utf8", i + 46, i + 46 + nameLen));
  }
  return names;
}

/** Fejler højt hvis pakken ikke er store-klar. */
function verifyZip(zipPath, expectedVersion) {
  const names = zipEntryNames(zipPath);
  if (names.length === 0) {
    throw new Error(`${zipPath}: kunne ikke læse nogen filer i arkivet`);
  }

  const backslashed = names.filter((n) => n.includes("\\"));
  if (backslashed.length > 0) {
    throw new Error(
      `${zipPath}: ${backslashed.length} sti(er) bruger backslash, fx "${backslashed[0]}". ` +
        "Butikkerne kræver forward slash — se Windows-noten i dette script.",
    );
  }

  if (!names.includes("manifest.json")) {
    throw new Error(
      `${zipPath}: manifest.json ligger ikke i arkivets rod (fandt: ${names.slice(0, 3).join(", ")}…)`,
    );
  }

  // Alle mapper i kilden (_locales/<chrome-kode>) skal med i arkivet; da, en, de og es er altid krævet.
  const shipped = readdirSync("_locales", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const l of new Set(["da", "en", "de", "es", ...shipped])) {
    if (!names.includes(`_locales/${l}/messages.json`)) {
      throw new Error(
        `${zipPath}: _locales/${l}/messages.json mangler i arkivet`,
      );
    }
  }

  // Versionen i manifestet skal matche den vi pakker under, ellers uploader
  // man en zip der hedder 2.4.0 men indeholder 2.3.0 (ramte os 15/9-2026,
  // hvor manifest.firefox.json blev glemt ved et version-bump).
  const dir = zipPath.includes("firefox") ? "dist-firefox" : "dist";
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${zipPath}: manifest.json siger version ${manifest.version}, men pakken hedder v${expectedVersion}. ` +
        "Husk at bumpe BÅDE package.json, manifest.json og manifest.firefox.json.",
    );
  }

  return names.length;
}

for (const { dir, zip } of targets) {
  if (!existsSync(dir)) {
    console.error(
      `Missing build dir "${dir}" — run "npm run build:all" first.`,
    );
    process.exit(1);
  }
  rmSync(zip, { force: true });

  if (platform === "win32") {
    // Eksplicit sti til Windows' bsdtar: et "tar" i PATH kan være GNU tar
    // (Git Bash), som ikke kan skrive zip.
    const bsdtar = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "tar.exe",
    );
    if (!existsSync(bsdtar)) {
      console.error(
        `Fandt ikke ${bsdtar}. Byg pakken på en maskine med bsdtar (Win10 17063+) eller kør "cd ${dir} && zip -qr ../${zip} ." i et miljø med zip.`,
      );
      process.exit(1);
    }
    // Filnavnene gives eksplicit i stedet for "." — ellers får hver post et
    // "./"-præfiks i arkivet. (execFileSync kører uden shell, så "*" ville
    // ikke blive ekspanderet.)
    const entries = readdirSync(dir);
    execFileSync(bsdtar, ["-a", "-c", "-f", join("..", zip), ...entries], {
      cwd: dir,
      stdio: "inherit",
    });
  } else {
    // cd into the dir so the archive root is the manifest, not the dir name.
    execFileSync("sh", ["-c", `cd '${dir}' && zip -qr '../${zip}' .`], {
      stdio: "inherit",
    });
  }

  const count = verifyZip(zip, version);
  console.log(`Packaged ${zip} (${count} filer, verificeret)`);
}
