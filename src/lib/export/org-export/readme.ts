import { toIntlLocale } from "@/i18n/format-locale";
import type { Tx } from "@/i18n/server-text";
import type { CollectedTable } from "./collect";
import type { FileManifestRow } from "./files";
import { ORG_EXPORT_EXCLUDED, REDACTED_COLUMNS } from "./registry";
import { USER_EXCLUSION_GROUPS } from "./user-registry";
import type { OrgExportMeta } from "./zip";

/** Tidspunkt i dansk tid, formateret efter sproget. */
function exportedAtText(exportedAt: Date, locale: string): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    dateStyle: "long",
    timeStyle: "short",
  }).format(exportedAt);
}

/** Linjerne i en flerlinjet katalogtekst. */
const block = (text: string): string[] => text.split("\n");

/** README.txt i ZIP'en. Ren tekst, CRLF, så den kan læses i Notesblok. */
export function buildReadme(
  tables: CollectedTable[],
  fileCount: number,
  manifest: FileManifestRow[],
  meta: OrgExportMeta,
  t: Tx,
): string {
  const locale = meta.locale ?? "da";
  const notFetched = manifest.filter((m) => m.status !== "Med").length;
  const who = meta.organizationName
    ? t("readme.whoNamed", { name: meta.organizationName })
    : meta.organizationId
      ? t("readme.whoOrg")
      : t("readme.whoAccount");
  const missing =
    notFetched > 0 ? t("readme.filesMissing", { count: notFetched }) : "";

  const lines: string[] = [
    ...block(t("readme.orgTitle")),
    "",
    t("readme.orgIntro", {
      who,
      date: exportedAtText(meta.exportedAt, locale),
    }),
    "",
    ...block(t("readme.content")),
    ...block(t("readme.orgDataJson")),
    "",
    ...block(t("readme.csv")),
    "",
    ...block(t("readme.orgFiles")),
    t("readme.orgFilesCount", { count: fileCount, extra: missing }),
    ...block(t("readme.orgFilesTail")),
    "",
    ...block(t("readme.orgRelations")),
    "",
    ...block(t("readme.tables")),
  ];

  for (const tbl of tables) {
    lines.push(
      t("readme.orgTableLine", {
        file: tbl.entry.file,
        label: t(`orgTables.${tbl.entry.key}`),
        count: tbl.rows.length,
      }),
    );
  }

  lines.push(
    "",
    ...block(t("readme.excludedHeading")),
    ...block(t("readme.redacted")),
    `  ${[...REDACTED_COLUMNS].sort().join(", ")}`,
    "",
    t("readme.orgExcludedTables"),
  );
  for (const key of Object.keys(ORG_EXPORT_EXCLUDED).sort()) {
    lines.push(`  ${key}: ${t(`orgExcluded.${key}`)}`);
  }

  lines.push(
    "",
    t("readme.orgOtherOrgs"),
    "",
    ...block(t("readme.orgRetention")),
    "",
    t("readme.questions"),
    "",
  );

  return lines.join("\r\n");
}

/**
 * README.txt i bruger-eksporten ("Hent dine egne data"). Skrevet til den
 * enkelte medarbejder: hvad der er med, hvad der ikke er, og hvem man spørger
 * om resten.
 */
export function buildUserReadme(
  tables: CollectedTable[],
  fileCount: number,
  manifest: FileManifestRow[],
  meta: OrgExportMeta,
  t: Tx,
): string {
  const locale = meta.locale ?? "da";
  const notFetched = manifest.filter((m) => m.status !== "Med").length;
  const where = meta.organizationName
    ? t("readme.whereNamed", { name: meta.organizationName })
    : t("readme.whereAccount");
  const missing =
    notFetched > 0 ? t("readme.filesMissing", { count: notFetched }) : "";

  const lines: string[] = [
    ...block(t("readme.userTitle")),
    "",
    t("readme.userIntro", {
      where,
      date: exportedAtText(meta.exportedAt, locale),
    }),
    "",
    ...block(t("readme.content")),
    ...block(t("readme.userDataJson")),
    "",
    ...block(t("readme.csv")),
    "",
    ...block(t("readme.userFiles")),
    t("readme.userFilesCount", { count: fileCount, extra: missing }),
    "",
    ...block(t("readme.userRelations")),
    "",
    ...block(t("readme.tables")),
  ];

  for (const tbl of tables) {
    lines.push(
      t("readme.userTableLine", {
        file: tbl.entry.file,
        label: t(
          tbl.entry.file.startsWith("reference-")
            ? `userRefTables.${tbl.entry.key}`
            : `userTables.${tbl.entry.key}`,
        ),
        count: tbl.rows.length,
      }),
    );
  }

  lines.push(
    "",
    ...block(t("readme.excludedHeading")),
    ...block(t("readme.userOwnOnly")),
    "",
    ...block(t("readme.userAdminOnly")),
    "",
    ...block(t("readme.redacted")),
    `  ${[...REDACTED_COLUMNS].sort().join(", ")}`,
    "",
    t("readme.userExcludedGroups"),
  );
  for (const group of Object.keys(USER_EXCLUSION_GROUPS)) {
    lines.push(`  - ${t(`userExclusionGroups.${group}`)}`);
  }

  lines.push(
    "",
    ...block(t("readme.userRetention")),
    "",
    t("readme.questions"),
    "",
  );

  return lines.join("\r\n");
}
