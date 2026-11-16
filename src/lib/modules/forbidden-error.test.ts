import { describe, expect, it } from "vitest";
import { isModuleDisabledError } from "./forbidden-error";

describe("isModuleDisabledError", () => {
  it("genkender guardedRouters modul-FORBIDDEN", () => {
    expect(
      isModuleDisabledError({
        data: { code: "FORBIDDEN", appCode: "MODULE_DISABLED" },
        message: 'The "clients" module is not enabled for this organization.',
      }),
    ).toBe(true);
  });

  it("skelner fra rolle-baseret FORBIDDEN (anden besked)", () => {
    expect(
      isModuleDisabledError({
        data: { code: "FORBIDDEN" },
        message: "Du har ikke adgang til at se detaljer for denne medarbejder.",
      }),
    ).toBe(false);
  });

  it("afviser andre fejlkoder", () => {
    expect(
      isModuleDisabledError({
        data: { code: "INTERNAL_SERVER_ERROR", appCode: "MODULE_DISABLED" },
        message: "Modulet er ikke aktiveret for denne organisation.",
      }),
    ).toBe(false);
  });

  it("håndterer null/undefined uden at kaste", () => {
    expect(isModuleDisabledError(null)).toBe(false);
    expect(isModuleDisabledError(undefined)).toBe(false);
  });
});
