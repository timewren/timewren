import { syncT } from "@/i18n/sync-text";
/**
 * Pure helpers til bulk-import af medarbejdere fra CSV.
 * Parsing og validering er adskilt fra server-mutationen så de kan testes.
 */

export interface EmployeeImportRow {
  name: string;
  email: string;
  department: string | null;
  role: "admin" | "hr" | "manager" | "member";
  weeklyHours: number;
  managerEmail: string | null;
  startDate: string | null; // YYYY-MM-DD
}

export interface ManagerLink {
  email: string;
  profileId: string;
  managerProfileId: string;
}

export interface MissingManager {
  email: string;
  managerEmail: string;
  reason: "not_found" | "self" | "cycle";
}

/**
 * Andet pas i importen (#464): oversæt managerEmail → managerId for hver
 * række, uafhængigt af rækkefølgen i filen. `lookupProfileId` slår en email
 * op blandt både nyoprettede og eksisterende profiler. Selv-reference og
 * cykler inden for filen (A→B→A) springes over og rapporteres.
 */
export function resolveImportManagers(
  rows: Array<Pick<EmployeeImportRow, "email" | "managerEmail">>,
  lookupProfileId: (email: string) => string | null,
): { links: ManagerLink[]; missing: MissingManager[] } {
  const links: ManagerLink[] = [];
  const missing: MissingManager[] = [];
  const accepted = new Map<string, string>(); // email → managerEmail

  for (const r of rows) {
    if (!r.managerEmail) continue;
    const email = r.email.toLowerCase();
    const managerEmail = r.managerEmail.toLowerCase();
    if (managerEmail === email) {
      missing.push({ email, managerEmail, reason: "self" });
      continue;
    }
    const profileId = lookupProfileId(email);
    const managerProfileId = lookupProfileId(managerEmail);
    if (!profileId || !managerProfileId) {
      missing.push({ email, managerEmail, reason: "not_found" });
      continue;
    }
    // Følg kæden af ALLEREDE accepterede links fra lederen; rammer vi os
    // selv, ville dette link lukke en cykel.
    let cursor: string | undefined = managerEmail;
    let cycle = false;
    for (let i = 0; cursor && i < rows.length + 1; i++) {
      if (cursor === email) {
        cycle = true;
        break;
      }
      cursor = accepted.get(cursor);
    }
    if (cycle) {
      missing.push({ email, managerEmail, reason: "cycle" });
      continue;
    }
    accepted.set(email, managerEmail);
    links.push({ email, profileId, managerProfileId });
  }
  return { links, missing };
}

export interface ParsedImport {
  rows: EmployeeImportRow[];
  errors: Array<{ line: number; message: string }>;
}

/** Simpel CSV-parser med auto-detekteret separator (; eller ,) og citater. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, keyof RawRow> = {
  navn: "name",
  name: "name",
  email: "email",
  mail: "email",
  afdeling: "department",
  department: "department",
  rolle: "role",
  role: "role",
  "timer pr uge": "weeklyHours",
  timer_pr_uge: "weeklyHours",
  "timer/uge": "weeklyHours",
  normtid: "weeklyHours",
  weekly_hours: "weeklyHours",
  leder: "managerEmail",
  leder_email: "managerEmail",
  "leder email": "managerEmail",
  manager: "managerEmail",
  manager_email: "managerEmail",
  startdato: "startDate",
  start_date: "startDate",
  ansat: "startDate",
};

interface RawRow {
  name?: string;
  email?: string;
  department?: string;
  role?: string;
  weeklyHours?: string;
  managerEmail?: string;
  startDate?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeRole(value: string): EmployeeImportRow["role"] | null {
  const v = value.trim().toLowerCase();
  if (v === "" || v === "medarbejder" || v === "member" || v === "ansat") {
    return "member";
  }
  if (v === "leder" || v === "manager" || v === "teamleder") return "manager";
  if (v === "hr" || v === "løn" || v === "lønansvarlig") return "hr";
  if (v === "admin" || v === "administrator") return "admin";
  return null;
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d;
}

function normalizeDate(value: string): string | null {
  const v = value.trim();
  if (v === "") return null;
  // YYYY-MM-DD
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return isValidYmd(Number(m[1]), Number(m[2]), Number(m[3])) ? v : "invalid";
  }
  // DD-MM-YYYY eller DD/MM/YYYY
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    if (!isValidYmd(Number(m[3]), Number(m[2]), Number(m[1]))) return "invalid";
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return "invalid";
}

/**
 * Parse + validér CSV-tekst til import-rækker. Header-rækken er påkrævet;
 * kolonnenavne matcher danske og engelske aliaser (rækkefølge er ligegyldig).
 */
export function parseEmployeeImport(text: string): ParsedImport {
  const errors: ParsedImport["errors"] = [];
  const cells = parseCsv(text);
  if (cells.length === 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: syncT("enterprise.import.fileEmpty") }],
    };
  }

  const header = cells[0].map((h) => h.trim().toLowerCase());
  const columnMap = new Map<number, keyof RawRow>();
  for (let i = 0; i < header.length; i++) {
    const key = HEADER_ALIASES[header[i]];
    if (key) columnMap.set(i, key);
  }
  if (
    !Array.from(columnMap.values()).includes("name") ||
    !Array.from(columnMap.values()).includes("email")
  ) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: syncT("enterprise.import.headerEmployees"),
        },
      ],
    };
  }

  const rows: EmployeeImportRow[] = [];
  const seenEmails = new Set<string>();

  for (let r = 1; r < cells.length; r++) {
    const line = r + 1;
    const raw: RawRow = {};
    for (const [idx, key] of columnMap) {
      raw[key] = (cells[r][idx] ?? "").trim();
    }

    const name = raw.name ?? "";
    const email = (raw.email ?? "").toLowerCase();
    if (!name) {
      errors.push({ line, message: syncT("enterprise.import.nameMissing") });
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({
        line,
        message: syncT("enterprise.import.invalidEmail", {
          value: raw.email ?? "",
        }),
      });
      continue;
    }
    if (seenEmails.has(email)) {
      errors.push({
        line,
        message: syncT("enterprise.import.duplicate", { email }),
      });
      continue;
    }
    seenEmails.add(email);

    const role = normalizeRole(raw.role ?? "");
    if (role === null) {
      errors.push({
        line,
        message: syncT("enterprise.import.unknownRole", {
          value: raw.role ?? "",
        }),
      });
      continue;
    }

    let weeklyHours = 37;
    if (raw.weeklyHours) {
      const parsed = Number(raw.weeklyHours.replace(",", "."));
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 60) {
        errors.push({
          line,
          message: syncT("enterprise.import.invalidWeeklyHours", {
            value: raw.weeklyHours,
          }),
        });
        continue;
      }
      weeklyHours = Math.round(parsed * 10) / 10;
    }

    const startDate = normalizeDate(raw.startDate ?? "");
    if (startDate === "invalid") {
      errors.push({
        line,
        message: syncT("enterprise.import.invalidStartDate", {
          value: raw.startDate ?? "",
        }),
      });
      continue;
    }

    const managerEmail = (raw.managerEmail ?? "").toLowerCase() || null;
    if (managerEmail && !EMAIL_RE.test(managerEmail)) {
      errors.push({
        line,
        message: syncT("enterprise.import.invalidManagerEmail", {
          value: raw.managerEmail ?? "",
        }),
      });
      continue;
    }

    rows.push({
      name,
      email,
      department: raw.department || null,
      role,
      weeklyHours,
      managerEmail,
      startDate,
    });
  }

  return { rows, errors };
}

/** Skabelon-CSV til download (dansk Excel-format). */
export const IMPORT_TEMPLATE_CSV = `navn;email;afdeling;rolle;timer_pr_uge;leder_email;startdato
Anne Eksempel;anne@firma.dk;Administration;medarbejder;37;leder@firma.dk;2026-08-01
Lars Leder;leder@firma.dk;Administration;leder;37;;2025-01-15
`;

// ---------------------------------------------------------------------------
// TimeLog-import: historiske tidsregistreringer
// ---------------------------------------------------------------------------

export interface TimeEntryImportRow {
  email: string;
  date: string; // YYYY-MM-DD
  hours: number;
  projectName: string | null;
  /** Aktivitetstype (#459) — valgfri kolonne; oprettes i org'en efter behov */
  activityName: string | null;
  description: string | null;
}

export interface ParsedTimeEntryImport {
  rows: TimeEntryImportRow[];
  errors: Array<{ line: number; message: string }>;
}

const ENTRY_HEADER_ALIASES: Record<string, keyof RawEntryRow> = {
  email: "email",
  mail: "email",
  medarbejder: "email",
  medarbejder_email: "email",
  "medarbejder email": "email",
  bruger: "email",
  dato: "date",
  date: "date",
  timer: "hours",
  antal: "hours",
  hours: "hours",
  tid: "hours",
  projekt: "projectName",
  project: "projectName",
  sag: "projectName",
  opgave: "projectName",
  aktivitet: "activityName",
  aktivitetstype: "activityName",
  activity: "activityName",
  beskrivelse: "description",
  kommentar: "description",
  note: "description",
  description: "description",
  comment: "description",
};

interface RawEntryRow {
  email?: string;
  date?: string;
  hours?: string;
  projectName?: string;
  activityName?: string;
  description?: string;
}

/**
 * Parse + validér en TimeLog-eksport (CSV) til tidsregistrerings-rækker.
 * Kræver kolonnerne email, dato og timer; projekt og beskrivelse er valgfri.
 */
export function parseTimeEntryImport(text: string): ParsedTimeEntryImport {
  const errors: ParsedTimeEntryImport["errors"] = [];
  const cells = parseCsv(text);
  if (cells.length === 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: syncT("enterprise.import.fileEmpty") }],
    };
  }

  const header = cells[0].map((h) => h.trim().toLowerCase());
  const columnMap = new Map<number, keyof RawEntryRow>();
  for (let i = 0; i < header.length; i++) {
    const key = ENTRY_HEADER_ALIASES[header[i]];
    if (key && !Array.from(columnMap.values()).includes(key)) {
      columnMap.set(i, key);
    }
  }
  const mapped = Array.from(columnMap.values());
  if (
    !mapped.includes("email") ||
    !mapped.includes("date") ||
    !mapped.includes("hours")
  ) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: syncT("enterprise.import.headerEntries"),
        },
      ],
    };
  }

  const rows: TimeEntryImportRow[] = [];
  for (let r = 1; r < cells.length; r++) {
    const line = r + 1;
    const raw: RawEntryRow = {};
    for (const [idx, key] of columnMap) {
      raw[key] = (cells[r][idx] ?? "").trim();
    }

    const email = (raw.email ?? "").toLowerCase();
    if (!EMAIL_RE.test(email)) {
      errors.push({
        line,
        message: syncT("enterprise.import.invalidEmail", {
          value: raw.email ?? "",
        }),
      });
      continue;
    }

    const date = normalizeDate(raw.date ?? "");
    if (date === null || date === "invalid") {
      errors.push({
        line,
        message: syncT("enterprise.import.invalidDate", {
          value: raw.date ?? "",
        }),
      });
      continue;
    }

    const hours = Number((raw.hours ?? "").replace(",", "."));
    if (Number.isNaN(hours) || hours <= 0 || hours > 24) {
      errors.push({
        line,
        message: syncT("enterprise.import.invalidHours", {
          value: raw.hours ?? "",
        }),
      });
      continue;
    }

    rows.push({
      email,
      date,
      hours: Math.round(hours * 100) / 100,
      projectName: raw.projectName || null,
      activityName: raw.activityName || null,
      description: raw.description || null,
    });
  }

  return { rows, errors };
}
