/**
 * Licens-endpoints uden login skal være throttlet pr. IP (#1103), så nøgler
 * ikke kan gættes eller afprøves i bulk. Delt limiter (Valkey når den er slået
 * til, ellers in-memory); her kører den in-memory.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/db", () => ({
  db: { query: { desktopLicenses: { findFirst } } },
}));

import { GET as legacyVerify } from "@/app/api/licenses/verify/route";
import { RATE_LIMIT_CONFIGS } from "@/lib/utils/rate-limiter";
import { POST as deactivate } from "./deactivate/route";
import { GET as verify } from "./verify/route";

const LIMIT = RATE_LIMIT_CONFIGS.desktopLicense.maxRequests;

let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return `203.0.113.${ipSeq}`;
}

function verifyReq(ip: string, path = "/api/desktop/license/verify") {
  return new NextRequest(`http://localhost${path}?key=TT-AAAA-BBBB-CCCC-DDDD`, {
    headers: { "x-forwarded-for": ip },
  });
}

function deactivateReq(ip: string) {
  return new Request("http://localhost/api/desktop/license/deactivate", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({
      licenseKey: "TT-AAAA-BBBB-CCCC-DDDD",
      machineId: "maskine-1",
    }),
  });
}

beforeEach(() => {
  findFirst.mockClear();
});

describe("rate limit på licens-endpoints", () => {
  it("verify svarer 429 efter grænsen og slår ikke nøglen op", async () => {
    const ip = nextIp();
    for (let i = 0; i < LIMIT; i++) {
      expect((await verify(verifyReq(ip))).status).toBe(200);
    }
    findFirst.mockClear();
    const res = await verify(verifyReq(ip));
    expect(res.status).toBe(429);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("en anden IP er ikke ramt af grænsen", async () => {
    const ip = nextIp();
    for (let i = 0; i <= LIMIT; i++) await verify(verifyReq(ip));
    expect((await verify(verifyReq(nextIp()))).status).toBe(200);
  });

  it("den gamle /api/licenses/verify deler grænsen med verify", async () => {
    const ip = nextIp();
    for (let i = 0; i < LIMIT; i++) await verify(verifyReq(ip));
    const res = await legacyVerify(verifyReq(ip, "/api/licenses/verify"));
    expect(res.status).toBe(429);
  });

  it("deactivate svarer 429 efter grænsen og slår ikke nøglen op", async () => {
    const ip = nextIp();
    for (let i = 0; i < LIMIT; i++) {
      expect((await deactivate(deactivateReq(ip))).status).toBe(404);
    }
    findFirst.mockClear();
    const res = await deactivate(deactivateReq(ip));
    expect(res.status).toBe(429);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
