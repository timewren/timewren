import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Nyheder" (changelog) handler om TimeTrack og dets integrationer, ikke om
 * demoen. Med DEMO_MODE=1 hentes ulæste nyheder derfor slet ikke, så modalen
 * aldrig åbner af sig selv og prikken aldrig vises (#1213).
 */

const { useQuery } = vi.hoisted(() => ({
  useQuery: vi.fn((_input: unknown, opts: { enabled?: boolean }) => ({
    data: opts.enabled === false ? undefined : [{ id: "c1" }],
  })),
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: { changelog: { getUnseen: { useQuery } } },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  useQuery.mockClear();
});

import { ChangelogDot } from "../ChangelogDot";

describe("ChangelogDot / useHasUnseenChangelog", () => {
  it("henter ikke nyheder i demo-tilstand", () => {
    vi.stubEnv("DEMO_MODE", "1");
    expect(renderToStaticMarkup(createElement(ChangelogDot))).toBe("");
    expect(useQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: false }),
    );
  });

  it("henter og viser ulæste nyheder som hidtil uden demo-tilstand", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(renderToStaticMarkup(createElement(ChangelogDot))).toContain(
      "rounded-full",
    );
    expect(useQuery).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ enabled: true }),
    );
  });
});
