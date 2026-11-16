import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/config";

const BASE_URL = getAppUrl();

export async function GET() {
  const catalog = {
    linkset: [
      {
        anchor: `${BASE_URL}/api/v1/`,
        "service-desc": [
          {
            href: `${BASE_URL}/api/v1/openapi.json`,
            type: "application/json",
          },
        ],
        "service-doc": [
          {
            href: `${BASE_URL}/api/v1/docs`,
            type: "text/html",
          },
        ],
        status: [
          {
            href: `${BASE_URL}/api/health`,
            type: "application/json",
          },
        ],
      },
    ],
  };

  return NextResponse.json(catalog, {
    headers: {
      "Content-Type": "application/linkset+json",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
