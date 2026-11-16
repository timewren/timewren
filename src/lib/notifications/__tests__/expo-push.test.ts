import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: mocks.update,
  },
}));

import {
  EXPO_PUSH_CHUNK_SIZE,
  EXPO_PUSH_URL,
  isExpoPushToken,
  sendExpoPush,
} from "../expo-push";

function token(i: number): string {
  return `ExponentPushToken[tok-${i}]`;
}

function okResponse(tickets: unknown[]): Response {
  return new Response(JSON.stringify({ data: tickets }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("isExpoPushToken", () => {
  it("accepts both Expo token formats and rejects garbage", () => {
    expect(isExpoPushToken("ExponentPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc]")).toBe(true);
    expect(isExpoPushToken("abc")).toBe(false);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
  });
});

describe("sendExpoPush", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    mocks.update.mockReset();
    mocks.set.mockReset();
    mocks.where.mockReset();
    mocks.update.mockReturnValue({ set: mocks.set });
    mocks.set.mockReturnValue({ where: mocks.where });
    mocks.where.mockResolvedValue(undefined);
    delete process.env.EXPO_ACCESS_TOKEN;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing for an empty or all-invalid token list", async () => {
    const result = await sendExpoPush(["not-a-token"], {
      title: "t",
      body: "b",
    });
    expect(result).toEqual({ attempted: 0, sent: 0, deactivated: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chunks into requests of at most 100 messages and counts ok tickets", async () => {
    const tokens = Array.from({ length: 250 }, (_, i) => token(i));
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const messages = JSON.parse(init.body as string) as { to: string }[];
      return okResponse(messages.map(() => ({ status: "ok", id: "x" })));
    });

    const result = await sendExpoPush(tokens, { title: "Hej", body: "Verden" });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(
      ([, init]) =>
        (JSON.parse((init as RequestInit).body as string) as unknown[]).length,
    );
    expect(sizes).toEqual([EXPO_PUSH_CHUNK_SIZE, EXPO_PUSH_CHUNK_SIZE, 50]);
    expect(fetchMock.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    expect(result).toEqual({ attempted: 250, sent: 250, deactivated: [] });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("sends the payload fields Expo expects, without Authorization when no token is set", async () => {
    fetchMock.mockResolvedValue(okResponse([{ status: "ok" }]));

    await sendExpoPush([token(1)], {
      title: "Hej",
      body: "Verden",
      data: { url: "/dashboard/tasks" },
      badge: 3,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual([
      {
        to: token(1),
        title: "Hej",
        body: "Verden",
        data: { url: "/dashboard/tasks" },
        badge: 3,
        sound: "default",
      },
    ]);
  });

  it("adds a Bearer header when EXPO_ACCESS_TOKEN is set", async () => {
    process.env.EXPO_ACCESS_TOKEN = "secret";
    fetchMock.mockResolvedValue(okResponse([{ status: "ok" }]));

    await sendExpoPush([token(1)], { title: "t", body: "b" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret",
    );
  });

  it("deactivates tokens Expo reports as DeviceNotRegistered", async () => {
    fetchMock.mockResolvedValue(
      okResponse([
        { status: "ok", id: "a" },
        {
          status: "error",
          message: "gone",
          details: { error: "DeviceNotRegistered", expoPushToken: token(2) },
        },
        {
          status: "error",
          message: "no token in details",
          details: { error: "DeviceNotRegistered" },
        },
        {
          status: "error",
          message: "rate",
          details: { error: "MessageRateExceeded" },
        },
      ]),
    );

    const result = await sendExpoPush(
      [token(1), token(2), token(3), token(4)],
      { title: "t", body: "b" },
    );

    expect(result.sent).toBe(1);
    expect(result.deactivated).toEqual([token(2), token(3)]);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
    expect(mocks.where).toHaveBeenCalledTimes(1);
  });

  it("never throws on HTTP or network failure", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockRejectedValueOnce(new Error("ECONNRESET"));

    const tokens = Array.from({ length: 101 }, (_, i) => token(i));
    const result = await sendExpoPush(tokens, { title: "t", body: "b" });

    expect(result).toEqual({ attempted: 101, sent: 0, deactivated: [] });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
