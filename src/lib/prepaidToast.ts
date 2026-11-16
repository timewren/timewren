import { toast } from "sonner";
import { prepaidBalanceLevel } from "@/lib/prepaid/balance";

export interface PrepaidDeductionInfo {
  packageName: string;
  remainingHours: number;
  totalHours: number;
  hoursDeducted: number;
}

/** "2.50" → "2,5", "3.00" → "3" */
function fmtHours(n: number): string {
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

/**
 * Viser en toast med hvad der blev trukket og hvad der er tilbage på
 * klippekortet. Returnerer false hvis der ikke var noget klippekort-træk,
 * så kalderen kan vise sin almindelige succes-toast i stedet.
 */
export function showPrepaidDeductionToast(
  deduction: PrepaidDeductionInfo | null | undefined,
): boolean {
  if (!deduction) return false;
  const message = `Trukket ${fmtHours(deduction.hoursDeducted)}t fra "${deduction.packageName}" — ${fmtHours(deduction.remainingHours)}t tilbage`;
  if (
    prepaidBalanceLevel(deduction.remainingHours, deduction.totalHours) !== "ok"
  ) {
    toast.warning(message, {
      description: "Klippekortet er ved at være tomt — overvej et nyt",
      duration: 8000,
    });
  } else {
    toast.success(message);
  }
  return true;
}
