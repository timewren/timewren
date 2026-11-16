import { NextResponse } from "next/server";
import { reportOnlyCspFromEnv } from "@/lib/csp-report-only";
import { appUrlEnv } from "@/lib/runtime-env";
import {
  REPORT_ONLY_CSP_HEADER,
  SCALAR_API_REFERENCE_SCRIPT,
} from "@/lib/security-headers";

export async function GET() {
  const appUrl = appUrlEnv() || "http://localhost:3000";

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>TimeTrack API Docs</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script
    id="api-reference"
    data-url="${appUrl}/api/v1/openapi.json"
    data-configuration='${JSON.stringify({
      theme: "kepler",
      layout: "modern",
      hideDownloadButton: false,
      metaData: {
        title: "TimeTrack API Docs",
        description: "Public REST API for TimeTrack",
      },
    })}'
  ></script>
  <!-- Pinned to latest stable major. TODO: add SRI integrity hash. -->
  <script
    src="${SCALAR_API_REFERENCE_SCRIPT}"
    crossorigin="anonymous"
  ></script>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Cache-Control": "public, max-age=3600",
      // Outside the middleware matcher; no nonce needed, the inline script
      // is empty and allowed by hash (#1121).
      [REPORT_ONLY_CSP_HEADER]: reportOnlyCspFromEnv({
        scalarApiReference: true,
      }),
    },
  });
}
