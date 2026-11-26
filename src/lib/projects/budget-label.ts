import type { BudgetHealthStatus } from "./budget";

type BudgetLabelStatus = BudgetHealthStatus | "over";

export function budgetLabel(
  t: (
    key: "budgetStatus",
    values: { status: BudgetLabelStatus; used: number; total: number },
  ) => string,
  health: BudgetHealthStatus,
  used: number,
  total: number,
): string {
  return t("budgetStatus", {
    status: health === "red" && used > total ? "over" : health,
    used,
    total,
  });
}
