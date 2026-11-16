import { redirect } from "next/navigation";

export default function EmailIntegrationRedirect() {
  redirect("/dashboard/settings/email?tab=integration");
}
