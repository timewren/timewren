/**
 * En skrivning via token-API'et skal nå de andre enheder: web's isAuthed
 * publicerer `data_changed` for brugeren og org'en, som /api/ext/stream og
 * /api/realtime sender videre.
 */

import { describe, expect, it, vi } from "vitest";

const published = vi.hoisted(
  () => [] as Array<{ userId: string; orgId: unknown; domains: string[] }>,
);

vi.mock("@/lib/realtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/realtime")>();
  return {
    ...actual,
    publishDataChanged: vi.fn(
      async (userId: string, orgId: unknown, domains: readonly string[]) => {
        published.push({ userId, orgId, domains: [...domains] });
      },
    ),
  };
});

const { deviceCaller, seedAccount } = await import("./fixture");

const enabled = process.env.TT_DB_TESTS === "1";

describe.skipIf(!enabled)("token-skrivninger publiceres live", () => {
  it("kunde og projekt oprettet fra desktop → data_changed i brugerens org", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Live Kunde" },
    });
    await api.projects.create({
      token: acc.token,
      data: { name: "Live Projekt", clientId: client.id },
    });

    const mine = published.filter((p) => p.userId === acc.userId);
    expect(mine).toHaveLength(2);
    for (const p of mine) {
      expect(p.orgId).toBe(acc.orgId);
      expect(p.domains).toEqual(["clients", "projects"]);
    }
  });

  it("læsninger publicerer ikke", async () => {
    const acc = await seedAccount();
    await deviceCaller().extension.clients.list({ token: acc.token });
    expect(published.filter((p) => p.userId === acc.userId)).toHaveLength(0);
  });
});
