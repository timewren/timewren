import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/config";

const BASE_URL = getAppUrl();

export async function GET() {
  const index = {
    $schema: "https://agentskills.io/schema/v0.2.0/index.json",
    skills: [
      {
        name: "time-tracking",
        type: "api",
        description:
          "Create, read, update, and delete time entries for freelance work. Supports start/stop timer, manual entry, and batch operations.",
        url: `${BASE_URL}/api/v1/openapi.json`,
        sha256: "",
      },
      {
        name: "client-management",
        type: "api",
        description:
          "Manage freelance clients with CVR (Danish business registry) integration. Create, update, archive clients.",
        url: `${BASE_URL}/api/v1/openapi.json`,
        sha256: "",
      },
      {
        name: "invoicing",
        type: "api",
        description:
          "Create and manage invoices from tracked time. Supports line items, sending, and payment tracking.",
        url: `${BASE_URL}/api/v1/openapi.json`,
        sha256: "",
      },
      {
        name: "project-management",
        type: "api",
        description:
          "Manage projects with hourly rates, fixed prices, and prepaid hours packages (klippekort).",
        url: `${BASE_URL}/api/v1/openapi.json`,
        sha256: "",
      },
      {
        name: "reporting",
        type: "api",
        description:
          "Generate time and revenue reports with filtering, grouping, and export to CSV, XLSX, JSON, or PDF.",
        url: `${BASE_URL}/api/v1/openapi.json`,
        sha256: "",
      },
    ],
  };

  return NextResponse.json(index, {
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
}
