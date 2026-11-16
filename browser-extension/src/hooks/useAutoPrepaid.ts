import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { packagesForClient, pickAutoPrepaid } from "../lib/prepaid";
import { useAuthStore } from "../stores/authStore";

/**
 * Finder det klippekort en registrering på en given kunde skal trækkes fra.
 *
 * Ønsket fra kunde A (6/8-2026): tid registreret i extensionen skal lande på
 * kundens klippekort med det samme, i stedet for at skulle markeres som
 * klippekort inde i web-appen bagefter.
 *
 * Udvælgelsesreglen bor i lib/prepaid.ts (delt med timer-storen og testet i
 * prepaid.test.ts): kortet skal have auto-træk slået til og timer tilbage;
 * er der flere, vælges det der udløber først. Valget er kun et FORSLAG —
 * brugeren kan altid fravælge det, og serveren trækker aldrig uden et
 * eksplicit kort-id.
 */
export function useAutoPrepaid(clientId: string | null | undefined) {
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);

  const { data: packages, isLoading } = useQuery({
    queryKey: ["activePackages", selectedOrgId],
    queryFn: () => apiClient.getActivePackages(),
    staleTime: 1000 * 60 * 2,
    enabled: orgsLoaded,
  });

  const forClient = packagesForClient(packages, clientId);
  const autoPackage = pickAutoPrepaid(packages, clientId);

  return {
    /** Kortet der foreslås — null hvis kunden ingen har med auto-træk */
    autoPackage,
    /** Alle kundens kort med timer tilbage, til manuelt valg */
    packagesForClient: forClient,
    isLoading,
  };
}
