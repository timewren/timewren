export type ApprovalMode =
  | "off"
  | "per_entry"
  | "per_period"
  | "per_invoice_draft";

interface UserApproval {
  approvalWorkflow: string | null;
}

interface ClientApproval {
  approvalWorkflow: string | null;
}

/**
 * Resolve the effective approval workflow from the hierarchy:
 * Client override -> User global -> "off"
 */
export function resolveApprovalWorkflow(
  user: UserApproval,
  client: ClientApproval,
): ApprovalMode {
  if (client.approvalWorkflow) return client.approvalWorkflow as ApprovalMode;
  return (user.approvalWorkflow as ApprovalMode) ?? "off";
}
