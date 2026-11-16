"use client";

import { trpc } from "@/providers/trpc-provider";
import { InvoiceNudge } from "./InvoiceNudge";
import { PrepaidSuggestion } from "./PrepaidSuggestion";
import { useNudgeEligibility } from "./useNudges";

/**
 * Højst ét nudge ad gangen på kundesiden: faktura-nudget har forrang, og
 * klippekort-forslaget vises kun når der ikke er noget at fakturere.
 */
export function ClientNudges({ clientId }: { clientId: string }) {
  const eligibility = useNudgeEligibility();
  const { data: invoiceNudges, isLoading } =
    trpc.invoices.nudgeCandidates.useQuery(
      { clientId, limit: 1 },
      { enabled: eligibility.invoicing },
    );

  if (
    eligibility.invoicing &&
    (isLoading || (invoiceNudges?.length ?? 0) > 0)
  ) {
    return <InvoiceNudge clientId={clientId} surface="client_page" />;
  }
  return <PrepaidSuggestion clientId={clientId} surface="client_page" />;
}
