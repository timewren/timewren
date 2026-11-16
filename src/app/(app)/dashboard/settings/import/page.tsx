import { redirect } from "next/navigation";

export default function SettingsImportRedirect() {
  redirect("/dashboard/integrations/import-timeops");
}
