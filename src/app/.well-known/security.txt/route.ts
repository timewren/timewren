import { NextResponse } from "next/server";
import { brand } from "@/lib/brand";
import { getMarketingUrl } from "@/lib/config";

export async function GET() {
  // Offentlig base-URL (marketing-URL, ellers app-URL): her bor siden og
  // /security-policy.
  const base = getMarketingUrl().replace(/\/$/, "");
  // /security-policy er TimeTrack Clouds egen side; på andre brands er den en
  // marketingsti (404 på selvhost) eller TimeTrack-brandet, så den udelades.
  const policy =
    brand.id === "timetrack" ? `\nPolicy: ${base}/security-policy` : "";
  const securityTxt = `# ${brand.name} Security Policy
# If you find a security vulnerability, please report it responsibly.

Contact: mailto:${brand.securityEmail}
Expires: 2027-04-17T00:00:00.000Z
Preferred-Languages: da, en
Canonical: ${base}/.well-known/security.txt${policy}

# We appreciate responsible disclosure and will acknowledge reporters
# who follow coordinated disclosure practices.
# We aim to respond within 48 hours and resolve critical issues within 7 days.
`;

  return new NextResponse(securityTxt, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
