/**
 * Desktop 0.2.23, detektionen: kundens domæner, "ikke arbejde"-regler,
 * site-koblinger (udvidelsens domæne-koblinger) og lærte mønstre via token,
 * pr. bruger og org.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
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

describe.skipIf(!enabled)("detektion: domæner, regler, mønstre", () => {
  it("kundens domæner normaliseres, bevares ved ret uden domæner", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: {
        name: "Domænekunde",
        domains: ["WWW.Domaene.dk", "https://shop.domaene.dk/kurv"],
      },
    });
    expect(client.domains).toEqual(["domaene.dk", "shop.domaene.dk"]);

    // En ret uden domæner (fx web's formular) rører dem ikke.
    await api.clients.update({
      token: acc.token,
      id: client.id,
      data: { name: "Domænekunde ApS" },
    });
    let row = await db.query.clients.findFirst({
      where: eq(clients.id, client.id),
    });
    expect(row?.domains).toEqual(["domaene.dk", "shop.domaene.dk"]);

    await api.clients.update({
      token: acc.token,
      id: client.id,
      data: { name: "Domænekunde ApS", domains: [] },
    });
    row = await db.query.clients.findFirst({
      where: eq(clients.id, client.id),
    });
    expect(row?.domains).toEqual([]);

    const listed = await api.clients.list({ token: acc.token });
    expect(listed.find((c) => c.id === client.id)?.domains).toEqual([]);

    const err = await errorOf(
      api.clients.create({
        token: acc.token,
        data: { name: "Forkert", domains: ["ikke et domæne"] },
      }),
    );
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toContain("Ugyldigt domæne: ikke et domæne");
  });

  it("regler uden mål er 'ikke arbejde'; site-koblinger er domæne-reglerne", async () => {
    const acc = await seedAccount();
    const other = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Sitekunde" },
    });
    const project = await api.projects.create({
      token: acc.token,
      data: { name: "Siteprojekt", clientId: client.id },
    });

    const res = await api.rules.upsert({
      token: acc.token,
      rules: [
        {
          kind: "domain",
          pattern: "www.Sitekunde.dk",
          projectId: project.id,
          source: "extension",
          usageCount: 7,
          lastUsedAt: "2026-10-20T10:00:00.000Z",
        },
        { kind: "domain", pattern: "youtube.com", notWork: true },
        { kind: "app", pattern: "Spotify", notWork: true },
        { kind: "repo", pattern: "github.com/site/web", clientId: client.id },
      ],
    });
    expect(res.upserted).toBe(4);

    const matching = await api.rules.getMatchingRules({ token: acc.token });
    const byPattern = new Map(matching.rules.map((r) => [r.pattern, r]));
    expect(byPattern.get("youtube.com")).toMatchObject({
      notWork: true,
      projectId: null,
      clientId: null,
    });
    expect(byPattern.get("sitekunde.dk")?.notWork).toBe(false);

    const sites = await api.siteMappings.list({ token: acc.token });
    expect(sites).toEqual([
      {
        domain: "sitekunde.dk",
        projectId: project.id,
        clientId: client.id,
        usageCount: 7,
        lastUsed: "2026-10-20T10:00:00.000Z",
      },
    ]);
    // En fjernet kobling forsvinder; en anden bruger ser intet.
    await api.rules.remove({
      token: acc.token,
      ids: [byPattern.get("sitekunde.dk")?.id as string],
    });
    expect(await api.siteMappings.list({ token: acc.token })).toEqual([]);
    expect(await api.siteMappings.list({ token: other.token })).toEqual([]);

    // "Ikke arbejde" med et mål, eller en regel helt uden mål, afvises.
    for (const rule of [
      {
        kind: "app" as const,
        pattern: "Slack",
        notWork: true,
        clientId: client.id,
      },
      { kind: "app" as const, pattern: "Slack" },
    ]) {
      const err = await errorOf(
        api.rules.upsert({ token: acc.token, rules: [rule] }),
      );
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  it("lærte mønstre gemmes pr. nøgle og hentes igen, kun i egen org", async () => {
    const acc = await seedAccount();
    const other = await seedAccount();
    const api = deviceCaller().extension;
    const client = await api.clients.create({
      token: acc.token,
      data: { name: "Mønsterkunde" },
    });
    const project = await api.projects.create({
      token: acc.token,
      data: { name: "Mønsterprojekt", clientId: client.id },
    });
    const repoKey = { kind: "repo" as const, remote: "github.com/m/web" };
    const appKey = {
      kind: "appKeyword" as const,
      app: "Figma",
      keyword: "Mønster",
    };
    await api.patterns.upsert({
      token: acc.token,
      patterns: [
        {
          key: repoKey,
          votes: [
            {
              target: { clientId: client.id, projectId: project.id },
              weight: 2.5,
              confirmations: 2,
              corrections: 1,
              aiAnswers: 0,
            },
          ],
        },
        {
          key: appKey,
          votes: [{ target: {}, weight: 1, confirmations: 1 }],
        },
      ],
    });
    const first = await api.patterns.list({ token: acc.token });
    expect(first.patterns).toHaveLength(2);
    expect(first.patterns.find((p) => p.key.kind === "repo")).toMatchObject({
      key: repoKey,
      votes: [
        {
          target: { clientId: client.id, projectId: project.id },
          weight: 2.5,
          confirmations: 2,
          corrections: 1,
          aiAnswers: 0,
        },
      ],
    });
    expect(
      first.patterns.find((p) => p.key.kind === "appKeyword")?.votes,
    ).toEqual([
      {
        target: {},
        weight: 1,
        confirmations: 1,
        corrections: 0,
        aiAnswers: 0,
      },
    ]);

    // Samme nøgle igen (felterne i en anden rækkefølge): erstatter.
    await api.patterns.upsert({
      token: acc.token,
      patterns: [
        {
          key: { remote: "github.com/m/web", kind: "repo" } as typeof repoKey,
          votes: [{ target: { clientId: client.id }, weight: 4 }],
        },
      ],
    });
    const again = await api.patterns.list({ token: acc.token });
    expect(again.patterns).toHaveLength(2);
    expect(
      again.patterns.find((p) => p.key.kind === "repo")?.votes[0],
    ).toMatchObject({ target: { clientId: client.id }, weight: 4 });

    // Delta: kun ændringer efter serverTime (minus overlap) — her alle.
    const delta = await api.patterns.list({
      token: acc.token,
      since: again.serverTime,
    });
    expect(delta.patterns.length).toBeGreaterThanOrEqual(1);

    // Anden org: ser intet, og kan ikke pege på denne orgs projekt.
    expect((await api.patterns.list({ token: other.token })).patterns).toEqual(
      [],
    );
    const err = await errorOf(
      api.patterns.upsert({
        token: other.token,
        patterns: [
          {
            key: repoKey,
            votes: [{ target: { projectId: project.id }, weight: 1 }],
          },
        ],
      }),
    );
    expect(err.code).toBe("NOT_FOUND");

    // En rå titel er ikke en nøgletype.
    const bad = await errorOf(
      api.patterns.upsert({
        token: acc.token,
        patterns: [
          {
            key: { kind: "title", title: "Hemmeligt dokument" } as never,
            votes: [],
          },
        ],
      }),
    );
    expect(bad.code).toBe("BAD_REQUEST");
  });

  it("importen tager 'ikke arbejde'-regler", async () => {
    const acc = await seedAccount();
    const api = deviceCaller().extension;
    const res = await api.import.run({
      token: acc.token,
      dryRun: false,
      rules: [
        {
          localId: "r-x",
          kind: "domain",
          pattern: "netflix.com",
          notWork: true,
        },
      ],
    });
    expect(res.errors).toEqual([]);
    const matching = await api.rules.getMatchingRules({ token: acc.token });
    expect(matching.rules).toEqual([
      expect.objectContaining({ pattern: "netflix.com", notWork: true }),
    ]);
  });
});
