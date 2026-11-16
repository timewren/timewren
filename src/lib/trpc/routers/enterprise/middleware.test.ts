import { describe, expect, it, vi } from "vitest";
import { ensureEnterpriseEmployeeProfile } from "@/lib/trpc/routers/enterprise/middleware";

function makeDb({
  createdRows = [],
  foundRows = [],
}: {
  createdRows?: Array<{ id: string; role: string }>;
  foundRows?: Array<{ id: string; role: string } | undefined>;
}) {
  const returning = vi.fn().mockResolvedValue(createdRows);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  const findFirst = vi
    .fn()
    .mockImplementation(async () => foundRows.shift() ?? undefined);

  return {
    db: {
      insert,
      query: {
        employeeProfiles: { findFirst },
      },
    },
    calls: { findFirst, insert, values, onConflictDoNothing, returning },
  };
}

describe("ensureEnterpriseEmployeeProfile", () => {
  it("reuses an existing profile when a parallel lazy insert wins the race", async () => {
    const existing = { id: "profile-1", role: "admin" };
    const { db, calls } = makeDb({
      foundRows: [undefined, existing],
      createdRows: [],
    });

    const profile = await ensureEnterpriseEmployeeProfile(
      db as never,
      "org-1",
      "user-1",
      "admin",
    );

    expect(profile).toEqual(existing);
    expect(calls.findFirst).toHaveBeenCalledTimes(2);
    expect(calls.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(calls.returning).toHaveBeenCalledOnce();
  });

  it("does not lazy-create profiles for regular members", async () => {
    const { db, calls } = makeDb({ foundRows: [undefined] });

    const profile = await ensureEnterpriseEmployeeProfile(
      db as never,
      "org-1",
      "user-1",
      "member",
    );

    expect(profile).toBeUndefined();
    expect(calls.insert).not.toHaveBeenCalled();
  });
});
