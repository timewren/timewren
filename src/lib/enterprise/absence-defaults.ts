import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import type { AbsenceCategory } from "./absence-registration";
import type { VacationPool } from "./vacation";

export type DefaultAbsenceType = {
  name: string;
  category: AbsenceCategory;
  requiresDocumentation: boolean;
  /** Loft i dage pr. kalenderår — null = ubegrænset */
  annualCapDays: number | null;
  /** false = kolleger ser kun "Fravær" */
  visibleToColleagues: boolean;
  color: string;
  /** Lucide-ikonnavn (kebab-case) */
  icon: string;
  deductsVacation: boolean;
  vacationPool: VacationPool;
  deductsOvertime: boolean;
  requiresApproval: boolean;
  isDefault: boolean;
};

/**
 * Standard-fraværstyper for enterprise-orgs (#435). Kun ferie kræver
 * ansøgning — sygdom/afspadsering registreres direkte. Feriefridage trækker
 * fra sin egen pulje ("extra", den 6. ferieuge).
 */
export const DEFAULT_ABSENCE_TYPES: readonly DefaultAbsenceType[] = [
  {
    name: "Ferie",
    category: "vacation",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: true,
    color: "#3b82f6",
    icon: "tree-palm",
    deductsVacation: true,
    vacationPool: "vacation",
    deductsOvertime: false,
    requiresApproval: true,
    isDefault: true,
  },
  {
    name: "Feriefridage",
    category: "vacation",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: true,
    color: "#0ea5e9",
    icon: "sun",
    deductsVacation: true,
    vacationPool: "extra",
    deductsOvertime: false,
    requiresApproval: true,
    isDefault: false,
  },
  {
    name: "Sygdom",
    category: "sickness",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: false,
    color: "#ef4444",
    icon: "thermometer",
    deductsVacation: false,
    vacationPool: "vacation",
    deductsOvertime: false,
    requiresApproval: false,
    isDefault: false,
  },
  {
    name: "Barns 1. sygedag",
    category: "sickness",
    requiresDocumentation: false,
    annualCapDays: 2,
    visibleToColleagues: false,
    color: "#f97316",
    icon: "baby",
    deductsVacation: false,
    vacationPool: "vacation",
    deductsOvertime: false,
    requiresApproval: false,
    isDefault: false,
  },
  {
    name: "Omsorgsdag",
    category: "other",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: true,
    color: "#f59e0b",
    icon: "heart-handshake",
    deductsVacation: false,
    vacationPool: "vacation",
    deductsOvertime: false,
    requiresApproval: true,
    isDefault: false,
  },
  {
    name: "Barsel",
    category: "leave",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: true,
    color: "#8b5cf6",
    icon: "baby",
    deductsVacation: false,
    vacationPool: "vacation",
    deductsOvertime: false,
    requiresApproval: true,
    isDefault: false,
  },
  {
    name: "Afspadsering",
    category: "other",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: true,
    color: "#14b8a6",
    icon: "hourglass",
    deductsVacation: false,
    vacationPool: "vacation",
    deductsOvertime: true,
    requiresApproval: false,
    isDefault: false,
  },
  {
    name: "Kursus",
    category: "other",
    requiresDocumentation: false,
    annualCapDays: null,
    visibleToColleagues: true,
    color: "#10b981",
    icon: "graduation-cap",
    deductsVacation: false,
    vacationPool: "vacation",
    deductsOvertime: false,
    requiresApproval: true,
    isDefault: false,
  },
];

/**
 * Ren planlægning: hvilke standardtyper mangler, givet org'ens eksisterende
 * typer (inkl. arkiverede). Matcher på navn, case-insensitivt. isDefault
 * sættes KUN hvis org'en ikke allerede har en default-type (én ad gangen).
 */
export function planDefaultAbsenceTypes(
  existing: ReadonlyArray<{ name: string; isDefault: boolean }>,
): DefaultAbsenceType[] {
  const existingNames = new Set(
    existing.map((t) => t.name.trim().toLowerCase()),
  );
  const hasDefault = existing.some((t) => t.isDefault);
  return DEFAULT_ABSENCE_TYPES.filter(
    (t) => !existingNames.has(t.name.toLowerCase()),
  ).map((t) => ({ ...t, isDefault: t.isDefault && !hasDefault }));
}

/**
 * Opret de standardtyper org'en mangler. Idempotent: matcher på navn
 * (case-insensitivt) mod ALLE org'ens typer — også arkiverede, så en type
 * admin bevidst har fjernet ikke dukker op igen. Eksisterende typer ændres
 * ikke. Returnerer navnene på de oprettede typer.
 */
export async function ensureDefaultAbsenceTypes(
  db: PostgresJsDatabase<typeof schema>,
  orgId: string,
): Promise<string[]> {
  const existing = await db.query.absenceTypes.findMany({
    where: eq(schema.absenceTypes.organizationId, orgId),
    columns: { name: true, isDefault: true },
  });

  const missing = planDefaultAbsenceTypes(existing);
  if (missing.length === 0) return [];

  await db.insert(schema.absenceTypes).values(
    missing.map((t) => ({
      organizationId: orgId,
      name: t.name,
      color: t.color,
      icon: t.icon,
      deductsVacation: t.deductsVacation,
      vacationPool: t.vacationPool,
      deductsOvertime: t.deductsOvertime,
      requiresApproval: t.requiresApproval,
      category: t.category,
      requiresDocumentation: t.requiresDocumentation,
      annualCapDays: t.annualCapDays != null ? String(t.annualCapDays) : null,
      visibleToColleagues: t.visibleToColleagues,
      isDefault: t.isDefault,
    })),
  );

  return missing.map((t) => t.name);
}
