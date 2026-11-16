import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";

// RFC 8414 authorization server metadata (#912). The issuer is
// {app}/api/auth, so clients look it up path-inserted at
// /.well-known/oauth-authorization-server/api/auth; the root URL is served
// too for clients that only try that. better-auth builds the document.
const metadataHandler = oauthProviderAuthServerMetadata(
  auth as unknown as Parameters<typeof oauthProviderAuthServerMetadata>[0],
  { headers: { "Access-Control-Allow-Origin": "*" } },
);

export function GET(request: Request) {
  return metadataHandler(request);
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
