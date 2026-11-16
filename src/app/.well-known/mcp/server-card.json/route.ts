import { NextResponse } from "next/server";
import {
  mcpResourceMetadataUrl,
  mcpResourceUrl,
  oauthIssuer,
} from "@/lib/auth/mcp-oauth";
import { getAppUrl } from "@/lib/config";

const BASE_URL = getAppUrl();

export async function GET() {
  const card = {
    serverInfo: {
      name: "timetrack",
      title: "TimeTrack",
      version: "1.0.0",
      description:
        "MCP server for Danish freelance time tracking, clients, prepaid hours (klippekort) and invoicing. Connect with OAuth (sign in to TimeTrack) or a tk_live_ API key as Bearer token.",
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    transport: {
      type: "streamable-http",
      url: mcpResourceUrl(),
    },
    authentication: {
      type: "oauth2",
      authorizationServer: oauthIssuer(),
      protectedResourceMetadata: mcpResourceMetadataUrl(),
      alternatives: [
        {
          type: "bearer",
          description:
            "A tk_live_ API key from Settings → API in the TimeTrack dashboard.",
        },
      ],
    },
    documentation: `${BASE_URL}/api/v1/docs`,
  };

  return NextResponse.json(card, {
    headers: {
      "Cache-Control": "public, max-age=86400",
    },
  });
}
