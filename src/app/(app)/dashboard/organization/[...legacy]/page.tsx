import { redirect } from "next/navigation";

/** Ukendte adresser under /dashboard/organization giver ikke 404. */
export default function LegacyOrganizationRedirect() {
  redirect("/dashboard/organization");
}
