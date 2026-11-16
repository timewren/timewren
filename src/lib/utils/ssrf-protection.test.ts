import dns from "node:dns/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateUrlForSSRF } from "./ssrf-protection";

// IP-literaler DNS-resolver til sig selv, så disse tests rammer
// hostname-checkene deterministisk uden netværksafhængighed.
describe("validateUrlForSSRF (#203)", () => {
  it("afviser http (kræver https)", async () => {
    expect(await validateUrlForSSRF("http://example.com/hook")).toBeTruthy();
  });

  it("afviser loopback og private IPv4-ranges", async () => {
    expect(await validateUrlForSSRF("https://127.0.0.1/hook")).toBeTruthy();
    expect(await validateUrlForSSRF("https://10.0.0.5/hook")).toBeTruthy();
    expect(await validateUrlForSSRF("https://192.168.1.1/hook")).toBeTruthy();
    expect(await validateUrlForSSRF("https://169.254.169.254/")).toBeTruthy();
  });

  it("afviser CGNAT-rangen 100.64.0.0/10", async () => {
    expect(await validateUrlForSSRF("https://100.64.0.1/hook")).toBeTruthy();
    expect(await validateUrlForSSRF("https://100.127.255.254/")).toBeTruthy();
  });

  it("tillader offentlige IP'er lige uden for CGNAT-rangen", async () => {
    expect(await validateUrlForSSRF("https://100.63.255.255/")).toBeNull();
    expect(await validateUrlForSSRF("https://100.128.0.1/")).toBeNull();
  });

  it("afviser IPv4-mapped IPv6 mod loopback/private (rebinding-smuthul)", async () => {
    expect(
      await validateUrlForSSRF("https://[::ffff:127.0.0.1]/hook"),
    ).toBeTruthy();
    expect(
      await validateUrlForSSRF("https://[::ffff:10.0.0.1]/hook"),
    ).toBeTruthy();
    // Hex-form af de samme adresser — nogle Node-versioners URL-parser
    // normaliserer dotted-form hertil, så begge SKAL fanges.
    expect(
      await validateUrlForSSRF("https://[::ffff:7f00:1]/hook"),
    ).toBeTruthy();
    expect(
      await validateUrlForSSRF("https://[::ffff:a00:1]/hook"),
    ).toBeTruthy();
    // Offentlig IPv4-mapped (8.8.8.8) skal stadig tillades i begge former.
    expect(await validateUrlForSSRF("https://[::ffff:8.8.8.8]/")).toBeNull();
    expect(await validateUrlForSSRF("https://[::ffff:808:808]/")).toBeNull();
  });

  it("afviser IPv6-loopback og blocked hostnames", async () => {
    expect(await validateUrlForSSRF("https://[::1]/hook")).toBeTruthy();
    expect(await validateUrlForSSRF("https://localhost/hook")).toBeTruthy();
    expect(
      await validateUrlForSSRF("https://metadata.google.internal/"),
    ).toBeTruthy();
  });
});

describe("validateUrlForSSRF: DNS-fejl (#1111)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const dnsFails = () =>
    vi.spyOn(dns, "lookup").mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), {
        code: "ENOTFOUND",
      }),
    );

  it("afviser en URL hvis DNS-opslaget fejler (fail closed)", async () => {
    dnsFails();
    expect(
      await validateUrlForSSRF("https://findes-ikke.example/hook", {
        rejectOnDnsFailure: true,
      }),
    ).toBeTruthy();
  });

  it("lader standardkaldet (gem-validering) være uændret ved DNS-fejl", async () => {
    dnsFails();
    expect(
      await validateUrlForSSRF("https://findes-ikke.example/hook"),
    ).toBeNull();
  });
});
