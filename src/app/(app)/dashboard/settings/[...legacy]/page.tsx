import { redirect } from "next/navigation";
import { legacySettingsDestination } from "@/components/dashboard-nav/settings-legacy";

/**
 * Gamle og ukendte adresser under /dashboard/settings giver aldrig 404, men
 * sendes videre til den side, indstillingen bor på nu. Destinationen er en
 * intern sti, så redirect() ikke afhænger af request.url (#891).
 */
export default async function LegacySettingsRedirect({
  params,
}: {
  params: Promise<{ legacy: string[] }>;
}) {
  const { legacy } = await params;
  redirect(legacySettingsDestination(legacy));
}
