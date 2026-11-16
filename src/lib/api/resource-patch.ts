/**
 * PATCH-fletning for REST-ruter hvis tRPC-update er en fuld erstatning.
 *
 * `projects.update` og `prepaid.update` er bygget til redigeringsformularer,
 * der altid sender hele rækken; et manglende felt bliver ryddet. En REST-PATCH
 * skal kun ændre det der sendes (#718), så vi lægger body'en oven på den
 * gemte række: udeladt felt = uændret, eksplicit `null` = ryd.
 */

type Row = Record<string, unknown>;

/** Gemte timestamps er Date; tRPC-inputtet forventer en dato-streng. */
function toDateString(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return typeof value === "string" && value ? value : undefined;
}

/** null/undefined → undefined, så tRPC-mutationen rydder eller springer over. */
function orUndefined(value: unknown): unknown {
  return value ?? undefined;
}

/** Beløb kan sendes som tal; projectInput validerer dem som strenge. */
function toAmountString(value: unknown): string | undefined {
  return value != null ? String(value) : undefined;
}

const PROJECT_FIELDS = [
  "name",
  "description",
  "clientId",
  "hourlyRate",
  "fixedPrice",
  "monthlyBudgetHours",
  "budgetHours",
  "status",
  "startDate",
  "endDate",
  "urlPatterns",
  "roundingEnabled",
  "roundingMinutes",
  "roundingMethod",
] as const;

const PROJECT_AMOUNTS = new Set<string>([
  "hourlyRate",
  "fixedPrice",
  "monthlyBudgetHours",
  "budgetHours",
]);
const PROJECT_DATES = new Set<string>(["startDate", "endDate"]);
// Felter hvor projectInput selv accepterer null som "ryd".
const PROJECT_NULLABLE = new Set<string>([
  "clientId",
  "roundingEnabled",
  "roundingMinutes",
  "roundingMethod",
]);

export function mergeProjectPatch(existing: Row, body: Row): Row {
  const data: Row = {};
  for (const field of PROJECT_FIELDS) {
    const sent = Object.hasOwn(body, field);
    const value = sent ? body[field] : existing[field];
    if (value === null && sent && PROJECT_NULLABLE.has(field)) {
      data[field] = null;
      continue;
    }
    const normalized = PROJECT_AMOUNTS.has(field)
      ? toAmountString(value)
      : PROJECT_DATES.has(field)
        ? toDateString(value)
        : orUndefined(value);
    if (normalized !== undefined) data[field] = normalized;
  }
  return data;
}

/** Felter `prepaid.update` overskriver eller rydder, når de mangler. */
const PREPAID_REPLACED_FIELDS = [
  "name",
  "clientId",
  "totalHours",
  "hourlyRate",
  "purchaseDate",
  "expiryDate",
  "description",
  "clipSizeMinutes",
] as const;

export function mergePrepaidPatch(existing: Row, body: Row): Row {
  const data: Row = { ...body };
  for (const field of PREPAID_REPLACED_FIELDS) {
    if (Object.hasOwn(body, field)) continue;
    const value = existing[field];
    if (value == null) continue;
    if (field === "totalHours" || field === "hourlyRate") {
      data[field] = Number(value);
    } else if (field === "purchaseDate" || field === "expiryDate") {
      data[field] = toDateString(value);
    } else {
      data[field] = value;
    }
  }
  // prepaidPackageInput afviser null her; tRPC rydder dem når de mangler.
  for (const field of ["expiryDate", "description"] as const) {
    if (data[field] === null) delete data[field];
  }
  return data;
}
