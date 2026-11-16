import { describe, expect, it } from "vitest";
import { MCP_OAUTH_SCOPES } from "../mcp-oauth";
import {
  authorizePathFromSignedQuery,
  parseScopes,
  scopeLabel,
} from "../mcp-oauth-query";

describe("authorizePathFromSignedQuery", () => {
  it("fjerner signeringsparametre og prompt=login, bevarer resten", () => {
    const signed = new URLSearchParams([
      ["client_id", "abc"],
      ["resource", "https://timetrack.dk/api/v1/mcp"],
      ["prompt", "login consent"],
      ["exp", "1"],
      ["sig", "s"],
      ["ba_iat", "1"],
      ["ba_pl", "sess"],
      ["ba_param", "client_id"],
      ["ba_param", "sig"],
    ]);
    const path = authorizePathFromSignedQuery(signed);
    const params = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
    expect([...params.keys()].sort()).toEqual([
      "client_id",
      "prompt",
      "resource",
    ]);
    expect(params.get("prompt")).toBe("consent");
  });

  it("dropper prompt helt, når den kun var login", () => {
    const path = authorizePathFromSignedQuery(
      new URLSearchParams({ client_id: "abc", prompt: "login" }),
    );
    expect(new URLSearchParams(path.split("?")[1]).has("prompt")).toBe(false);
  });
});

describe("scopeLabel", () => {
  it("har en dansk tekst til alle OAuth-scopes", () => {
    for (const scope of MCP_OAUTH_SCOPES) {
      expect(scopeLabel(scope)).not.toBe(scope);
    }
    expect(scopeLabel("time:write")).toBe(
      "Se, oprette og ændre tidsregistreringer",
    );
    expect(scopeLabel("prepaid:read")).toBe("Se klippekort");
  });

  it("viser ukendte scopes uændret", () => {
    expect(scopeLabel("webhooks:read")).toBe("webhooks:read");
  });
});

describe("MCP_OAUTH_SCOPES", () => {
  it("giver aldrig wildcard, :all eller webhooks via OAuth", () => {
    expect(MCP_OAUTH_SCOPES).not.toContain("*");
    expect(MCP_OAUTH_SCOPES.some((s) => s.endsWith(":all"))).toBe(false);
    expect(MCP_OAUTH_SCOPES.some((s) => s.startsWith("webhooks"))).toBe(false);
  });
});

describe("parseScopes", () => {
  it("deler og fjerner dubletter", () => {
    expect(parseScopes("a  b a")).toEqual(["a", "b"]);
    expect(parseScopes(null)).toEqual([]);
  });
});
