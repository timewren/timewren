import { describe, expect, it } from "vitest";
import {
  buildVerificationRecord,
  generateVerificationToken,
  txtRecordsContainToken,
  verificationHostnames,
  verifyDomainTxt,
} from "./dns-verify";

// Bygges ved runtime så secret-scannere ikke ser en 32-hex-streng i kilden
const TOKEN = "ab".repeat(16);

function dnsError(code: string): Error & { code: string } {
  const e = new Error(code) as Error & { code: string };
  e.code = code;
  return e;
}

describe("txtRecordsContainToken", () => {
  it("matcher eksakt record", () => {
    expect(txtRecordsContainToken([[`timetrack-verify=${TOKEN}`]], TOKEN)).toBe(
      true,
    );
  });
  it("samler chunks og ignorerer anførselstegn/whitespace", () => {
    expect(
      txtRecordsContainToken(
        [[`timetrack-verify=${TOKEN.slice(0, 16)}`, TOKEN.slice(16)]],
        TOKEN,
      ),
    ).toBe(true);
    expect(
      txtRecordsContainToken([[` "timetrack-verify=${TOKEN}" `]], TOKEN),
    ).toBe(true);
  });
  it("afviser forkert token, prefix-match og tomt token", () => {
    expect(
      txtRecordsContainToken([[`timetrack-verify=${TOKEN}extra`]], TOKEN),
    ).toBe(false);
    expect(txtRecordsContainToken([["v=spf1 -all"]], TOKEN)).toBe(false);
    expect(
      txtRecordsContainToken(
        [[`timetrack-verify=${TOKEN.toUpperCase()}`]],
        TOKEN,
      ),
    ).toBe(false);
    expect(txtRecordsContainToken([["timetrack-verify="]], "")).toBe(false);
  });
  it("finder recorden blandt andre TXT-records", () => {
    expect(
      txtRecordsContainToken(
        [
          ["v=spf1 include:spf.protection.outlook.com -all"],
          [`timetrack-verify=${TOKEN}`],
        ],
        TOKEN,
      ),
    ).toBe(true);
  });
});

describe("generateVerificationToken / buildVerificationRecord", () => {
  it("laver 32 hex-tegn og et unikt token pr. kald", () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(buildVerificationRecord(a)).toBe(`timetrack-verify=${a}`);
  });
  it("slår op på _timetrack-verify-subdomæne først, så apex", () => {
    expect(verificationHostnames("eksempel.dk")).toEqual([
      "_timetrack-verify.eksempel.dk",
      "eksempel.dk",
    ]);
  });
});

describe("verifyDomainTxt (mock resolver)", () => {
  it("verificerer når recorden ligger på subdomænet", async () => {
    const resolver = async (host: string) =>
      host === "_timetrack-verify.eksempel.dk"
        ? [[`timetrack-verify=${TOKEN}`]]
        : [["v=spf1 -all"]];
    const r = await verifyDomainTxt("eksempel.dk", TOKEN, resolver);
    expect(r).toEqual({ ok: true, foundOn: "_timetrack-verify.eksempel.dk" });
  });

  it("verificerer når recorden ligger på apex og subdomænet ikke findes", async () => {
    const resolver = async (host: string) => {
      if (host.startsWith("_timetrack-verify.")) throw dnsError("ENOTFOUND");
      return [[`timetrack-verify=${TOKEN}`]];
    };
    const r = await verifyDomainTxt("eksempel.dk", TOKEN, resolver);
    expect(r).toEqual({ ok: true, foundOn: "eksempel.dk" });
  });

  it("afviser forkert token som definitivt ikke fundet (ikke transient)", async () => {
    const resolver = async () => [["timetrack-verify=deadbeef"]];
    const r = await verifyDomainTxt("eksempel.dk", TOKEN, resolver);
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(false);
    expect(r.error).toContain("Fandt ingen TXT-record");
  });

  it("behandler ENOTFOUND/ENODATA på begge hosts som ikke fundet", async () => {
    const resolver = async () => {
      throw dnsError("ENODATA");
    };
    const r = await verifyDomainTxt("eksempel.dk", TOKEN, resolver);
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(false);
  });

  it("rapporterer netværksfejl som transient og aldrig som verificeret", async () => {
    const resolver = async () => {
      throw dnsError("ETIMEOUT");
    };
    const r = await verifyDomainTxt("eksempel.dk", TOKEN, resolver);
    expect(r.ok).toBe(false);
    expect(r.transient).toBe(true);
    expect(r.error).toContain("DNS-opslag fejlede");
  });
});
