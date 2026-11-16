import { describe, expect, it } from "vitest";
import {
  type ClientVersionRow,
  DETECTORS,
  detectOutdatedClients,
} from "../detectors";

const at = new Date("2026-10-03T10:00:00Z");

function row(p: Partial<ClientVersionRow>): ClientVersionRow {
  return {
    organizationId: "org1",
    source: "extension",
    clientHint: null,
    n: 1,
    rejected: 0,
    users: 1,
    lastAt: at,
    ...p,
  };
}

describe("detectOutdatedClients", () => {
  const mins = { extension: "2.5.2" };

  it("er registreret med runbook-anker", () => {
    expect(DETECTORS.outdated_client.runbookAnchor).toContain(
      "outdated_client",
    );
  });

  it("sendes ikke til Sentry (forventet driftstilstand, TIMETRACK-1Z)", () => {
    expect(DETECTORS.outdated_client.sentry).toBe(false);
    expect(DETECTORS.hours_mismatch.sentry).not.toBe(false);
  });

  it("melder skrivninger under minimum som advarsel pr. org", () => {
    const f = detectOutdatedClients(
      [
        row({ clientHint: "extension@2.5.0 extension/chrome", n: 4, users: 2 }),
        row({ clientHint: "extension@2.5.2 extension/chrome", n: 9 }),
      ],
      mins,
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      detector: "outdated_client",
      severity: "warning",
      fingerprint: "outdated_client:org1:below",
      organizationId: "org1",
      userId: null,
    });
    expect(f[0].title).toContain("extension 2.5.0");
  });

  it("gammel extension uden header tæller som under minimum (≤ 2.5.1)", () => {
    const f = detectOutdatedClients(
      [row({ clientHint: "extension/chrome", n: 3 })],
      mins,
    );
    expect(f.map((x) => x.fingerprint)).toEqual(["outdated_client:org1:below"]);
  });

  it("afviste kald (client_too_old) er altid under minimum", () => {
    const f = detectOutdatedClients(
      [row({ clientHint: "mobile@1.0.0+4 mobilapp/ios", rejected: 2, n: 2 })],
      {},
    );
    expect(f[0].fingerprint).toBe("outdated_client:org1:below");
  });

  it("extension uden version er info, når minimummet ikke rammer den", () => {
    const f = detectOutdatedClients(
      [row({ clientHint: "extension/chrome", n: 5 })],
      { extension: "2.5.1" },
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      severity: "info",
      fingerprint: "outdated_client:org1:unknown",
    });
  });

  it("web, mobil og desktop uden header giver intet fund (mangler den endnu)", () => {
    expect(
      detectOutdatedClients(
        [
          row({ source: "web", clientHint: "chrome/windows", n: 5 }),
          row({ source: "mobile", clientHint: "mobilapp/ios", n: 2 }),
          row({ source: "desktop", clientHint: "desktop-tauri/mac", n: 2 }),
        ],
        mins,
      ),
    ).toEqual([]);
  });

  it("intet minimum og kun versionerede klienter = ingen fund", () => {
    expect(
      detectOutdatedClients(
        [
          row({ clientHint: "extension@2.5.0 extension/chrome" }),
          row({ source: "web", clientHint: "web@e64648eaabcd chrome/mac" }),
        ],
        {},
      ),
    ).toEqual([]);
  });

  it("holder org'er adskilt", () => {
    const f = detectOutdatedClients(
      [
        row({ organizationId: "a", clientHint: "extension@2.4.0 x" }),
        row({ organizationId: "b", clientHint: "extension@2.4.0 x" }),
      ],
      mins,
    );
    expect(f.map((x) => x.organizationId).sort()).toEqual(["a", "b"]);
  });
});
