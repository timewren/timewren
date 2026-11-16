import { describe, expect, it } from "vitest";
import {
  mutationPathFromKey,
  shouldInvalidateAfterMutation,
} from "./query-invalidation";

describe("mutationPathFromKey", () => {
  it("læser tRPC-nøglen [[router, procedure]]", () => {
    expect(mutationPathFromKey([["clients", "create"]])).toBe("clients.create");
  });

  it("returnerer null for tomme/ukendte nøgler", () => {
    expect(mutationPathFromKey(undefined)).toBeNull();
    expect(mutationPathFromKey([])).toBeNull();
    expect(mutationPathFromKey([[1, 2]])).toBeNull();
  });
});

describe("shouldInvalidateAfterMutation", () => {
  it("invaliderer efter almindelige data-mutationer", () => {
    expect(shouldInvalidateAfterMutation([["clients", "create"]])).toBe(true);
    expect(shouldInvalidateAfterMutation([["time", "update"]])).toBe(true);
    expect(shouldInvalidateAfterMutation([["prepaid", "toggleActive"]])).toBe(
      true,
    );
    expect(
      shouldInvalidateAfterMutation([["integrations", "importToggl"]]),
    ).toBe(true);
  });

  it("springer timer-heartbeat og andre støjende mutationer over", () => {
    expect(shouldInvalidateAfterMutation([["timerSync", "sync"]])).toBe(false);
    expect(shouldInvalidateAfterMutation([["timerSync", "claimForStop"]])).toBe(
      false,
    );
    expect(
      shouldInvalidateAfterMutation([["timerTemplates", "recordUsage"]]),
    ).toBe(false);
    expect(
      shouldInvalidateAfterMutation([["reportTemplates", "bumpUsage"]]),
    ).toBe(false);
    expect(shouldInvalidateAfterMutation([["changelog", "markSeen"]])).toBe(
      false,
    );
  });

  it("matcher præfikser kun på routergrænsen", () => {
    // "user.dismissBanner" er eksakt — "user.update" skal stadig invalidere
    expect(shouldInvalidateAfterMutation([["user", "update"]])).toBe(true);
    // "timerSync." er præfiks — "timer.create" er en anden router
    expect(shouldInvalidateAfterMutation([["timer", "create"]])).toBe(true);
  });

  it("invaliderer for en sikkerheds skyld ved ukendt nøgle", () => {
    expect(shouldInvalidateAfterMutation(undefined)).toBe(true);
  });
});
