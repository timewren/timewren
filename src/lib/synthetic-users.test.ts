import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { withEmailLogging } from "@/lib/email/logger";
import {
  isSyntheticEmail,
  isSyntheticUserId,
  syntheticUserIds,
} from "./synthetic-users";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("synthetic-users", () => {
  it("er tom og falsk uden env", () => {
    vi.stubEnv("SYNTHETIC_USER_IDS", "");
    vi.stubEnv("SYNTHETIC_USER_EMAILS", "");
    expect(syntheticUserIds()).toEqual([]);
    expect(isSyntheticUserId("abc")).toBe(false);
    expect(isSyntheticUserId(null)).toBe(false);
    expect(isSyntheticEmail("a@b.dk")).toBe(false);
  });

  it("matcher id'er præcist og e-mails uden hensyn til store bogstaver", () => {
    vi.stubEnv("SYNTHETIC_USER_IDS", " AbC123 , def ");
    vi.stubEnv("SYNTHETIC_USER_EMAILS", "Synth@Example.dk");
    expect(syntheticUserIds()).toEqual(["AbC123", "def"]);
    expect(isSyntheticUserId("AbC123")).toBe(true);
    expect(isSyntheticUserId("abc123")).toBe(false);
    expect(isSyntheticUserId("other")).toBe(false);
    expect(isSyntheticEmail(" synth@example.DK ")).toBe(true);
    expect(isSyntheticEmail("someone@example.dk")).toBe(false);
  });
});

describe("withEmailLogging for syntetiske konti", () => {
  it("sender aldrig — heller ikke kritisk mail — til en syntetisk adresse", async () => {
    vi.stubEnv("SYNTHETIC_USER_EMAILS", "synth@example.dk");
    const send = vi.fn().mockResolvedValue({ data: { id: "x" } });
    const res = await withEmailLogging(
      { emailType: "new_login", to: "synth@example.dk" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
    expect(res).toMatchObject({ skipped: true });
  });

  it("springer over på bruger-id fra tracking", async () => {
    vi.stubEnv("SYNTHETIC_USER_IDS", "u1");
    const send = vi.fn().mockResolvedValue({ data: { id: "x" } });
    await withEmailLogging({ emailType: "welcome", to: "x@example.dk" }, send, {
      userId: "u1",
      emailType: "welcome",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sender stadig til almindelige brugere", async () => {
    vi.stubEnv("SYNTHETIC_USER_IDS", "u1");
    vi.stubEnv("SYNTHETIC_USER_EMAILS", "synth@example.dk");
    const send = vi.fn().mockResolvedValue({ data: { id: "x" } });
    await withEmailLogging(
      { emailType: "new_login", to: "x@example.dk" },
      send,
    );
    expect(send).toHaveBeenCalledOnce();
  });
});
