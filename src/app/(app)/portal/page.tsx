import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function PortalPage() {
  const headersList = await headers();
  const customDomain = headersList.get("x-custom-domain");

  if (customDomain) {
    // On custom domains, middleware rewrites "/" to "/portal"
    // Redirect to login without /portal prefix (middleware handles it)
    redirect("/login");
  }

  redirect("/portal/login");
}
