import { describe, expect, it } from "vitest";
import { grantedScopesFromBody } from "@/lib/auth/mcp-oauth";

describe("grantedScopesFromBody", () => {
  it("bruger scope fra autorisationsforespørgslen, når body ikke har scope", () => {
    const body = {
      accept: true,
      oauth_query: "client_id=abc&scope=time_entries%3Aread+offline_access",
    };
    expect(grantedScopesFromBody(body)).toEqual([
      "time_entries:read",
      "offline_access",
    ]);
  });

  it("foretrækker et eksplicit scope i body", () => {
    const body = {
      accept: true,
      scope: "time_entries:read",
      oauth_query: "client_id=abc&scope=time_entries%3Aread+clients%3Awrite",
    };
    expect(grantedScopesFromBody(body)).toEqual(["time_entries:read"]);
  });

  it("giver undefined uden scope", () => {
    expect(grantedScopesFromBody({ accept: true })).toBeUndefined();
  });
});
