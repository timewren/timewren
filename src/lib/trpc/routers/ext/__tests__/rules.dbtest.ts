/**
 * extension.rules.*: projekternes urlPatterns + bekræftede koblinger fra
 * udvidelse/desktop, idempotent gemning, tombstones og org-isolation.
 */

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deviceMatchRules } from "@/lib/db/schema";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

describe.skipIf(!enabled)("extension.rules (token-API)", () => {
  it("samler aktive projekters urlPatterns og bekræftede koblinger", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Bageriet" },
    });
    const active = await api.projects.create({
      token: acc.token,
      data: {
        name: "Webshop",
        clientId: client.id,
        urlPatterns: ["*bageriet.dk/*", "github.com/bageriet/*"],
      },
    });
    const archived = await api.projects.create({
      token: acc.token,
      data: { name: "Gammel", clientId: client.id, urlPatterns: ["*old*"] },
    });
    await api.projects.archive({ token: acc.token, id: archived.id });

    const rule = {
      kind: "domain" as const,
      pattern: "WWW.Bageriet.dk",
      projectId: active.id,
      source: "extension" as const,
      usageCount: 3,
    };
    await api.rules.upsert({ token: acc.token, rules: [rule] });
    // Samme regel igen (offline-kø): én række, højeste brugstal vinder.
    await api.rules.upsert({
      token: acc.token,
      rules: [{ ...rule, pattern: "bageriet.dk", usageCount: 1 }],
    });

    const res = await api.rules.getMatchingRules({ token: acc.token });
    expect(res.projectPatterns).toEqual([
      {
        projectId: active.id,
        projectName: "Webshop",
        clientId: client.id,
        clientName: "Bageriet",
        patterns: ["*bageriet.dk/*", "github.com/bageriet/*"],
      },
    ]);
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0]).toMatchObject({
      kind: "domain",
      pattern: "bageriet.dk",
      projectId: active.id,
      // Kunden udledes af projektet.
      clientId: client.id,
      usageCount: 3,
      deletedAt: null,
    });
  });

  it("fjernede regler ses som tombstone med since, ikke i den fulde liste", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Repo-kunde" },
    });
    const { ids } = await api.rules.upsert({
      token: acc.token,
      rules: [
        {
          kind: "repo",
          pattern: "git@github.com:x/y.git",
          clientId: client.id,
        },
      ],
    });
    const first = await api.rules.getMatchingRules({ token: acc.token });

    await api.rules.remove({ token: acc.token, ids });
    expect(
      (await api.rules.getMatchingRules({ token: acc.token })).rules,
    ).toHaveLength(0);
    const delta = await api.rules.getMatchingRules({
      token: acc.token,
      since: first.serverTime,
    });
    expect(delta.rules).toHaveLength(1);
    expect(delta.rules[0].deletedAt).not.toBeNull();

    // Bekræftes den igen, genopstår den.
    await api.rules.upsert({
      token: acc.token,
      rules: [
        {
          kind: "repo",
          pattern: "git@github.com:x/y.git",
          clientId: client.id,
        },
      ],
    });
    const row = await db.query.deviceMatchRules.findFirst({
      where: and(
        eq(deviceMatchRules.userId, acc.userId),
        eq(deviceMatchRules.kind, "repo"),
      ),
    });
    expect(row?.deletedAt).toBeNull();
  });

  it("kan ikke koble til en anden orgs projekt eller se/fjerne dens regler", async () => {
    const a = await seedAccount();
    const b = await seedAccount();
    const api = deviceCaller().extension;
    const aClient = await api.clients.create({
      token: a.token,
      data: { name: "A-kunde" },
    });
    const { ids } = await api.rules.upsert({
      token: a.token,
      rules: [{ kind: "app", pattern: "Figma", clientId: aClient.id }],
    });

    const err = await errorOf(
      api.rules.upsert({
        token: b.token,
        rules: [{ kind: "app", pattern: "Figma", clientId: aClient.id }],
      }),
    );
    expect(err.code).toBe("NOT_FOUND");
    expect(
      (await api.rules.getMatchingRules({ token: b.token })).rules,
    ).toHaveLength(0);
    expect((await api.rules.remove({ token: b.token, ids })).removed).toBe(0);
    expect(
      (await api.rules.getMatchingRules({ token: a.token })).rules,
    ).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("notWork kun til klienter, der forstår dem", () => {
  async function seedRules() {
    const acc = await seedAccount();
    const desktop = deviceCaller("desktop/0.2.24").extension;
    const client = await desktop.clients.create({
      token: acc.token,
      data: { name: "Regelkunde" },
    });
    await desktop.rules.upsert({
      token: acc.token,
      rules: [
        { kind: "domain", pattern: "kunde.dk", clientId: client.id },
        { kind: "domain", pattern: "youtube.com", notWork: true },
      ],
    });
    return { acc, client };
  }

  it("udvidelsens svar er uændret: ingen notWork-regler", async () => {
    const { acc } = await seedRules();
    const extension = deviceCaller("extension/2.8.0").extension;
    const res = await extension.rules.getMatchingRules({ token: acc.token });
    expect(res.rules.map((r) => r.pattern)).toEqual(["kunde.dk"]);
    expect(res.rules.every((r) => r.notWork === false)).toBe(true);

    // Samme svar (bortset fra serverTime) som i en konto uden notWork-regler.
    const plain = await seedAccount();
    const desktop = deviceCaller("desktop/0.2.24").extension;
    const c2 = await desktop.clients.create({
      token: plain.token,
      data: { name: "Regelkunde" },
    });
    await desktop.rules.upsert({
      token: plain.token,
      rules: [{ kind: "domain", pattern: "kunde.dk", clientId: c2.id }],
    });
    const ref = await extension.rules.getMatchingRules({ token: plain.token });
    const shape = (r: typeof res) =>
      r.rules.map(({ id, clientId, lastUsedAt, updatedAt, ...rest }) => rest);
    expect(shape(res)).toEqual(shape(ref));
    expect(Object.keys(res).sort()).toEqual(Object.keys(ref).sort());

    // En klient uden header (ældre udvidelse) får dem heller ikke.
    const legacy = deviceCaller("").extension;
    const legacyRes = await legacy.rules.getMatchingRules({ token: acc.token });
    expect(legacyRes.rules.map((r) => r.pattern)).toEqual(["kunde.dk"]);
  });

  it("desktop og includeNotWork: true får notWork-reglerne", async () => {
    const { acc } = await seedRules();
    const desktop = deviceCaller("desktop/0.2.24").extension;
    const d = await desktop.rules.getMatchingRules({ token: acc.token });
    expect(d.rules.map((r) => r.pattern).sort()).toEqual([
      "kunde.dk",
      "youtube.com",
    ]);
    expect(d.rules.find((r) => r.pattern === "youtube.com")?.notWork).toBe(
      true,
    );

    const extension = deviceCaller("extension/2.8.0").extension;
    const e = await extension.rules.getMatchingRules({
      token: acc.token,
      includeNotWork: true,
    });
    expect(e.rules.map((r) => r.pattern).sort()).toEqual([
      "kunde.dk",
      "youtube.com",
    ]);
  });

  it("en regel, der bliver notWork, er fjernet for udvidelsen i delta", async () => {
    const { acc } = await seedRules();
    const extension = deviceCaller("extension/2.8.0").extension;
    const first = await extension.rules.getMatchingRules({ token: acc.token });
    expect(first.rules.map((r) => r.pattern)).toEqual(["kunde.dk"]);

    await deviceCaller("desktop/0.2.24").extension.rules.upsert({
      token: acc.token,
      rules: [{ kind: "domain", pattern: "kunde.dk", notWork: true }],
    });
    const delta = await extension.rules.getMatchingRules({
      token: acc.token,
      since: first.serverTime,
    });
    const flipped = delta.rules.find((r) => r.pattern === "kunde.dk");
    expect(flipped?.deletedAt).not.toBeNull();
    // Inden for overlap-vinduet kan en notWork-regel komme med, men kun
    // som fjernet (klienten fjerner et ukendt id = intet).
    for (const r of delta.rules.filter((x) => x.pattern === "youtube.com")) {
      expect(r.deletedAt).not.toBeNull();
    }
  });
});
