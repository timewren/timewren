import { NextResponse } from "next/server";
import {
  MCP_OAUTH_SCOPES,
  mcpResourceUrl,
  oauthIssuer,
} from "@/lib/auth/mcp-oauth";
import { getAppUrl } from "@/lib/config";

const BASE_URL = getAppUrl();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// RFC 9728 protected resource metadata for the MCP endpoint (#912). Served
// both at the root and at the path-inserted URL
// (/.well-known/oauth-protected-resource/api/v1/mcp) that MCP clients derive
// from the resource URL and that the 401 challenge points to. The REST API
// (/api/v1/*) still authenticates with API keys only.
export async function GET() {
  const metadata = {
    resource: mcpResourceUrl(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: MCP_OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "TimeTrack MCP",
    resource_documentation: `${BASE_URL}/api/v1/docs`,
  };

  return NextResponse.json(metadata, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
