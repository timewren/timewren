export const RESOURCES = [
  "clients",
  "projects",
  "time",
  "invoices",
  "prepaid",
  "tasks",
  "reports",
  "webhooks",
] as const;

export type Resource = (typeof RESOURCES)[number];
export type Permission = "read" | "write" | "all";
export type Scope = `${Resource}:${Permission}` | "*";

const VALID_SCOPES = new Set<string>([
  "*",
  ...RESOURCES.flatMap((r) => [`${r}:read`, `${r}:write`, `${r}:all`]),
]);

export function isValidScope(scope: string): scope is Scope {
  return VALID_SCOPES.has(scope);
}

export function validateScopes(scopes: string[]): scopes is Scope[] {
  return scopes.every(isValidScope);
}

/**
 * Check if a set of scopes grants access to a resource+permission.
 * - "*" grants everything
 * - "write" and "all" both include "read"
 */
export function hasScope(
  scopes: string[],
  resource: Resource,
  permission: "read" | "write",
): boolean {
  if (scopes.includes("*")) return true;

  if (permission === "read") {
    return (
      scopes.includes(`${resource}:read`) ||
      scopes.includes(`${resource}:write`) ||
      scopes.includes(`${resource}:all`)
    );
  }

  // write permission
  return (
    scopes.includes(`${resource}:write`) || scopes.includes(`${resource}:all`)
  );
}
