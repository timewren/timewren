import { describe, expect, it } from "vitest";
import {
  type AccessLevel,
  accessSatisfies,
  PERMISSION_MODULE_KEYS,
} from "./role-access";

describe("accessSatisfies", () => {
  it("write level satisfies both read and write requirements", () => {
    expect(accessSatisfies("write", "read")).toBe(true);
    expect(accessSatisfies("write", "write")).toBe(true);
  });

  it("read level satisfies read but not write", () => {
    expect(accessSatisfies("read", "read")).toBe(true);
    expect(accessSatisfies("read", "write")).toBe(false);
  });

  it("none level satisfies nothing", () => {
    expect(accessSatisfies("none", "read")).toBe(false);
    expect(accessSatisfies("none", "write")).toBe(false);
  });

  it("covers every access level for a read requirement", () => {
    const expected: Record<AccessLevel, boolean> = {
      none: false,
      read: true,
      write: true,
    };
    for (const level of ["none", "read", "write"] as AccessLevel[]) {
      expect(accessSatisfies(level, "read")).toBe(expected[level]);
    }
  });
});

describe("PERMISSION_MODULE_KEYS", () => {
  it("matches the modules exposed by the permissions UI / rolePermissions", () => {
    // Guard against drift: these are the keys the permissions matrix and the
    // module procedures rely on.
    expect([...PERMISSION_MODULE_KEYS].sort()).toEqual(
      [
        "calendar",
        "clients",
        "enterprise",
        "invoices",
        "klippekort",
        "projects",
        "reports",
        "settings",
        "tasks",
        "templates",
        "time",
      ].sort(),
    );
  });

  it("has no duplicate keys", () => {
    expect(new Set(PERMISSION_MODULE_KEYS).size).toBe(
      PERMISSION_MODULE_KEYS.length,
    );
  });
});
