/**
 * Enheds-login ende til ende mod Postgres: browser-godkendelse med state og
 * PKCE → veksling → token med enhedsinfo → fornyelse → tilbagekaldelse i
 * web. Login-CSRF og genbrug af koder skal afvises.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    auth: { ...actual.auth, api: { getSession: mocks.getSession } },
  };
});

const { POST: approve } = await import("@/app/api/ext/device/approve/route");
const { GET: stream } = await import("@/app/api/ext/stream/route");
const { NextRequest } = await import("next/server");
const { authenticateDeviceToken } = await import("../device-procedure");
const { REFRESH_REUSE_GRACE_MS } = await import("../device");
const { codeChallengeS256, DEVICE_ACCESS_TTL_MS } = await import(
  "@/lib/device-login"
);
const { db } = await import("@/lib/db");
const { extensionTokens, members, organizations } = await import(
  "@/lib/db/schema"
);
const { deviceCaller, seedAccount, webCaller } = await import("./fixture");

const enabled = process.env.TT_DB_TESTS === "1";

let ipCounter = 0;

/** Ny IP pr. kald, så exchange/refresh-loftet (10/15 min) ikke deles. */
function api() {
  ipCounter += 1;
  return deviceCaller("desktop/1.0.0", `10.8.0.${ipCounter}`).extension;
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

/** Appens side: state, verifier og challenge. */
function startLogin() {
  const state = `st_${randomUUID().replaceAll("-", "")}`;
  const codeVerifier = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
  return {
    state,
    codeVerifier,
    codeChallenge: codeChallengeS256(codeVerifier),
    deviceId: `dev-${randomUUID()}`,
  };
}

async function approveInBrowser(
  login: ReturnType<typeof startLogin>,
  extra: Record<string, unknown> = {},
  origin = "http://localhost:3000",
) {
  ipCounter += 1;
  const res = await approve(
    new Request("http://localhost:3000/api/ext/device/approve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-forwarded-for": `10.9.0.${ipCounter}`,
      },
      body: JSON.stringify({
        state: login.state,
        codeChallenge: login.codeChallenge,
        deviceId: login.deviceId,
        deviceName: "Mads' MacBook",
        os: "macOS 15",
        kind: "desktop",
        ...extra,
      }),
    }),
  );
  return {
    status: res.status,
    body: (await res.json()) as { redirectUrl?: string; error?: string },
  };
}

function codeFrom(redirectUrl: string) {
  const url = new URL(redirectUrl);
  return {
    protocol: url.protocol,
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state") ?? "",
  };
}

describe.skipIf(!enabled)("enheds-login (desktop 1.0)", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
  });

  it("godkend → veksl → brug → forny → tilbagekald i web", async () => {
    const acc = await seedAccount();
    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });
    const login = startLogin();

    const approved = await approveInBrowser(login);
    expect(approved.status).toBe(200);
    const link = codeFrom(approved.body.redirectUrl ?? "");
    expect(link.protocol).toBe("timetrack:");
    expect(link.state).toBe(login.state);
    // Deep linket indeholder ingen token, kun engangskoden.
    expect(approved.body.redirectUrl).not.toMatch(/token/i);

    const session = await api().device.exchangeCode({
      code: link.code,
      codeVerifier: login.codeVerifier,
      state: login.state,
      deviceId: login.deviceId,
    });
    expect(session.organizationId).toBe(acc.orgId);
    expect(session.user.id).toBe(acc.userId);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Koden kan ikke bruges igen.
    expect(
      (
        await errorOf(
          api().device.exchangeCode({
            code: link.code,
            codeVerifier: login.codeVerifier,
            state: login.state,
            deviceId: login.deviceId,
          }),
        )
      ).code,
    ).toBe("UNAUTHORIZED");

    // Tokenet virker på token-API'et og står med enhedsinfo i web's liste.
    await api().clients.list({ token: session.accessToken });
    const listed = await webCaller(acc).extension.listTokens();
    const mine = listed.find((t) => t.deviceName === "Mads' MacBook");
    expect(mine).toMatchObject({
      name: "TimeTrack Desktop (Mads' MacBook)",
      deviceOs: "macOS 15",
      clientKind: "desktop",
    });

    // Fornyelse roterer begge tokens.
    const renewed = await api().device.refresh({
      refreshToken: session.refreshToken,
      deviceId: login.deviceId,
    });
    expect(renewed.accessToken).not.toBe(session.accessToken);
    expect(
      (await errorOf(api().clients.list({ token: session.accessToken }))).code,
    ).toBe("UNAUTHORIZED");
    // Det gamle refresh-tokens nådeperiode dækkes af testene længere nede.
    await api().clients.list({ token: renewed.accessToken });

    // Tilbagekald i web → token og refresh holder op med at virke, og
    // strømmens løbende tjek afviser det.
    await webCaller(acc).extension.revokeToken({ tokenId: mine?.id ?? "" });
    expect(
      (await errorOf(api().clients.list({ token: renewed.accessToken }))).code,
    ).toBe("UNAUTHORIZED");
    await expect(
      authenticateDeviceToken(db, renewed.accessToken),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(
      (
        await errorOf(
          api().device.refresh({
            refreshToken: renewed.refreshToken,
            deviceId: login.deviceId,
          }),
        )
      ).code,
    ).toBe("UNAUTHORIZED");
  });

  it("afviser forkert verifier, forkert state og en anden enheds id", async () => {
    const acc = await seedAccount();
    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });

    for (const tamper of ["verifier", "state", "device"] as const) {
      const login = startLogin();
      const { body } = await approveInBrowser(login);
      const { code } = codeFrom(body.redirectUrl ?? "");
      const err = await errorOf(
        api().device.exchangeCode({
          code,
          codeVerifier:
            tamper === "verifier"
              ? startLogin().codeVerifier
              : login.codeVerifier,
          state: tamper === "state" ? startLogin().state : login.state,
          deviceId: tamper === "device" ? "dev-angriber-123" : login.deviceId,
        }),
      );
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("udløbet kode virker ikke", async () => {
    const acc = await seedAccount();
    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });
    const login = startLogin();
    const { body } = await approveInBrowser(login);
    const { code } = codeFrom(body.redirectUrl ?? "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    try {
      const err = await errorOf(
        api().device.exchangeCode({
          code,
          codeVerifier: login.codeVerifier,
          state: login.state,
          deviceId: login.deviceId,
        }),
      );
      expect(err.code).toBe("UNAUTHORIZED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("godkendelse kræver login, rigtig oprindelse og medlemskab af valgt org", async () => {
    const acc = await seedAccount();
    const other = await seedAccount();
    const login = startLogin();

    mocks.getSession.mockResolvedValue(null);
    expect((await approveInBrowser(login)).status).toBe(401);

    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });
    expect(
      (await approveInBrowser(login, {}, "https://ond.example")).status,
    ).toBe(403);
    expect(
      (await approveInBrowser(login, { organizationId: other.orgId })).status,
    ).toBe(403);
    expect(
      (await approveInBrowser({ ...login, codeChallenge: "plain" })).status,
    ).toBe(400);
  });

  it("valgt org gælder som standard, og nyt login på samme enhed afløser det gamle", async () => {
    const acc = await seedAccount();
    // Brugeren er også medlem af en anden org og vælger den ved login.
    const secondOrg = `dev-org2-${randomUUID()}`;
    await db
      .insert(organizations)
      .values({ id: secondOrg, name: "Org 2", slug: secondOrg } as never);
    await db.insert(members).values({
      id: `m2-${randomUUID()}`,
      organizationId: secondOrg,
      userId: acc.userId,
      role: "member",
    } as never);
    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });

    const login = startLogin();
    const { body } = await approveInBrowser(login, {
      organizationId: secondOrg,
    });
    const { code } = codeFrom(body.redirectUrl ?? "");
    const first = await api().device.exchangeCode({
      code,
      codeVerifier: login.codeVerifier,
      state: login.state,
      deviceId: login.deviceId,
    });
    expect(first.organizationId).toBe(secondOrg);
    const ent = await api().entitlements.get({ token: first.accessToken });
    expect(ent.organizationId).toBe(secondOrg);

    // Log ind igen fra samme enhed: det gamle token tilbagekaldes.
    const again = { ...startLogin(), deviceId: login.deviceId };
    const second = await approveInBrowser(again);
    const c2 = codeFrom(second.body.redirectUrl ?? "");
    const next = await api().device.exchangeCode({
      code: c2.code,
      codeVerifier: again.codeVerifier,
      state: again.state,
      deviceId: login.deviceId,
    });
    expect(
      (await errorOf(api().clients.list({ token: first.accessToken }))).code,
    ).toBe("UNAUTHORIZED");

    // Log ud fra appen.
    await api().device.logout({ token: next.accessToken });
    const rows = await db.query.extensionTokens.findMany({
      where: eq(extensionTokens.deviceId, login.deviceId),
    });
    expect(rows.every((r) => r.isRevoked)).toBe(true);
  });

  it("refresh giver en org, brugeren stadig er medlem af", async () => {
    const acc = await seedAccount();
    const secondOrg = `dev-org2-${randomUUID()}`;
    await db
      .insert(organizations)
      .values({ id: secondOrg, name: "Org 2", slug: secondOrg } as never);
    const memberId = `m2-${randomUUID()}`;
    await db.insert(members).values({
      id: memberId,
      organizationId: secondOrg,
      userId: acc.userId,
      role: "member",
    } as never);
    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });

    const login = startLogin();
    const { body } = await approveInBrowser(login, {
      organizationId: secondOrg,
    });
    const { code } = codeFrom(body.redirectUrl ?? "");
    const session = await api().device.exchangeCode({
      code,
      codeVerifier: login.codeVerifier,
      state: login.state,
      deviceId: login.deviceId,
    });
    expect(session.organizationId).toBe(secondOrg);

    // Brugeren fjernes fra den valgte org: fornyelsen må ikke pege på den.
    await db.delete(members).where(eq(members.id, memberId));
    const renewed = await api().device.refresh({
      refreshToken: session.refreshToken,
      deviceId: login.deviceId,
    });
    expect(renewed.organizationId).toBe(acc.orgId);
  });

  /** Login og én fornyelse; returnerer det roterede (gamle) og det nye par. */
  async function loginAndRefresh() {
    const acc = await seedAccount();
    mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });
    const login = startLogin();
    const { body } = await approveInBrowser(login);
    const { code } = codeFrom(body.redirectUrl ?? "");
    const session = await api().device.exchangeCode({
      code,
      codeVerifier: login.codeVerifier,
      state: login.state,
      deviceId: login.deviceId,
    });
    const renewed = await api().device.refresh({
      refreshToken: session.refreshToken,
      deviceId: login.deviceId,
    });
    const refresh = (refreshToken: string) =>
      api().device.refresh({ refreshToken, deviceId: login.deviceId });
    /** Lægger seneste rotation `ms` tilbage i tiden. */
    const rotatedAgo = (ms: number) =>
      db
        .update(extensionTokens)
        .set({ expiresAt: new Date(Date.now() + DEVICE_ACCESS_TTL_MS - ms) })
        .where(eq(extensionTokens.deviceId, login.deviceId));
    return { session, renewed, refresh, rotatedAgo };
  }

  it("et tabt refresh-svar: det gamle token giver nye tokens inden for nådeperioden, men kun én gang", async () => {
    const { session, renewed, refresh } = await loginAndRefresh();

    // Svaret med `renewed` nåede aldrig appen; den prøver igen med det gamle.
    const retry = await refresh(session.refreshToken);
    expect(retry.accessToken).not.toBe(renewed.accessToken);
    await api().clients.list({ token: retry.accessToken });
    expect(
      (await errorOf(api().clients.list({ token: renewed.accessToken }))).code,
    ).toBe("UNAUTHORIZED");

    // Det gamle token kan ikke genudstede igen, og sessionen lever videre.
    expect((await errorOf(refresh(session.refreshToken))).code).toBe(
      "UNAUTHORIZED",
    );
    await api().clients.list({ token: retry.accessToken });
  });

  it("genbrug af et roteret refresh-token efter nådeperioden tilbagekalder sessionen", async () => {
    const { session, renewed, refresh, rotatedAgo } = await loginAndRefresh();
    await rotatedAgo(REFRESH_REUSE_GRACE_MS + 5_000);
    expect((await errorOf(refresh(session.refreshToken))).code).toBe(
      "UNAUTHORIZED",
    );
    expect(
      (await errorOf(api().clients.list({ token: renewed.accessToken }))).code,
    ).toBe("UNAUTHORIZED");
  });

  it("en genudstedelse forlænger ikke nådeperioden for det token, den erstattede", async () => {
    const { session, renewed, refresh, rotatedAgo } = await loginAndRefresh();
    const retry = await refresh(session.refreshToken);
    // `renewed` er nu det roterede token. Bruges det efter nådeperioden,
    // er det genbrug, og sessionen lukkes.
    await rotatedAgo(REFRESH_REUSE_GRACE_MS + 5_000);
    expect((await errorOf(refresh(renewed.refreshToken))).code).toBe(
      "UNAUTHORIZED",
    );
    expect(
      (await errorOf(api().clients.list({ token: retry.accessToken }))).code,
    ).toBe("UNAUTHORIZED");
  });

  it("live-strømmen overlever en refresh og lukker først ved tilbagekald", async () => {
    vi.stubEnv("REALTIME_ENABLED", "true");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const acc = await seedAccount();
      mocks.getSession.mockResolvedValue({ user: { id: acc.userId } });
      const login = startLogin();
      const { body } = await approveInBrowser(login);
      const { code } = codeFrom(body.redirectUrl ?? "");
      const session = await api().device.exchangeCode({
        code,
        codeVerifier: login.codeVerifier,
        state: login.state,
        deviceId: login.deviceId,
      });

      const res = await stream(
        new NextRequest("http://localhost/api/ext/stream", {
          headers: { authorization: `Bearer ${session.accessToken}` },
        }),
      );
      expect(res.status).toBe(200);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      await reader.read(); // connected
      await reader.read(); // første ping

      // Almindelig fornyelse: samme enhed, ny hash på samme række.
      await api().device.refresh({
        refreshToken: session.refreshToken,
        deviceId: login.deviceId,
      });
      await vi.advanceTimersByTimeAsync(25_000);
      const afterRefresh = decoder.decode((await reader.read()).value);
      expect(afterRefresh).toContain("event: ping");
      expect(afterRefresh).not.toContain("revoked");

      // Tilbagekald i web → revoked + lukket.
      const listed = await webCaller(acc).extension.listTokens();
      const row = listed.find((t) => t.deviceName === "Mads' MacBook");
      await webCaller(acc).extension.revokeToken({ tokenId: row?.id ?? "" });
      await vi.advanceTimersByTimeAsync(25_000);
      const afterRevoke = decoder.decode((await reader.read()).value);
      expect(afterRevoke).toContain("event: revoked");
      expect((await reader.read()).done).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
