import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_URL,
  DEFAULT_WEB_APP_URL,
  resolveApiUrl,
  validateApiUrlInput,
} from "./config";

describe("validateApiUrlInput", () => {
  it("tomt felt giver standardadressen", () => {
    expect(validateApiUrlInput("  ")).toEqual({
      ok: true,
      value: DEFAULT_WEB_APP_URL,
    });
  });

  it("fuld API-URL og afsluttende skråstreg normaliseres", () => {
    expect(validateApiUrlInput("https://beta.timetrack.dk/api/trpc/")).toEqual({
      ok: true,
      value: "https://beta.timetrack.dk",
    });
  });

  it("self-host addresses require HTTPS and will be checked by discovery", () => {
    expect(validateApiUrlInput("https://tid.example.org").ok).toBe(true);
    expect(validateApiUrlInput("http://tid.example.org").ok).toBe(false);
    expect(validateApiUrlInput("timetrack").ok).toBe(false);
  });
});

afterEach(() => vi.unstubAllEnvs());
it("allows only private HTTP addresses in development", () => {
  vi.stubEnv("MODE", "development");
  expect(validateApiUrlInput("http://192.168.1.2:3000").ok).toBe(true);
  expect(validateApiUrlInput("http://example.org").ok).toBe(false);
  vi.stubEnv("MODE", "production");
  expect(validateApiUrlInput("http://192.168.1.2:3000").ok).toBe(false);
  expect(validateApiUrlInput("http://localhost:3000").ok).toBe(false);
});

it("falls back to Cloud when a saved apiUrl is no longer valid", async () => {
  vi.stubEnv("MODE", "production");
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async () => ({
          extensionSettings: { apiUrl: "http://localhost:3000" },
        }),
      },
    },
    permissions: { contains: vi.fn().mockResolvedValue(false) },
  });
  await expect(resolveApiUrl()).resolves.toBe(DEFAULT_API_URL);
  vi.unstubAllGlobals();
});
