// Ressourceplan (#508): hvem må hvad. Ren logik — routeren slår rolle og
// plan op og spørger her.

import { type OrgRole, roleCanWriteTeam } from "@/lib/permissions/org-role";

export type ResourcePlanViewScope = "all" | "team" | "self";

export interface ResourcePlanAccess {
  /** Må oprette/ændre planen (ejer, admin, leder) */
  canPlan: boolean;
  /** Hvem der ses: hele org'en, lederens egne medarbejdere eller kun en selv */
  scope: ResourcePlanViewScope;
}

/**
 * Ejer/admin planlægger for hele organisationen, en leder for sine egne
 * medarbejdere. HR ser alt men planlægger ikke (read-all-rolle). Et medlem ser
 * kun sin egen plan.
 */
export function resourcePlanAccess(
  role: OrgRole | null | undefined,
): ResourcePlanAccess {
  if (role === "owner" || role === "admin")
    return { canPlan: true, scope: "all" };
  if (role === "hr") return { canPlan: false, scope: "all" };
  if (role === "manager") {
    return { canPlan: roleCanWriteTeam(role), scope: "team" };
  }
  return { canPlan: false, scope: "self" };
}
