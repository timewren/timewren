import { describe, expect, it } from "vitest";
import { countSeatUsage } from "./seat-usage";

/**
 * countSeatUsage rammer databasen, så testen bruger en minimal fake der
 * fanger det where-udtryk queryen bygger. Pointen er ikke SQL'ens form, men
 * at udløbne invitationer ikke må tælle med som optagne pladser.
 */
function fakeDb(memberCount: number, inviteCount: number) {
  const calls: unknown[] = [];
  let table = 0;
  return {
    calls,
    select() {
      return {
        from(t: unknown) {
          calls.push(t);
          table += 1;
          const isMembers = table === 1;
          return {
            where(expr: unknown) {
              calls.push(expr);
              return Promise.resolve([
                { count: isMembers ? memberCount : inviteCount },
              ]);
            },
          };
        },
      };
    },
  };
}

/** Findes der et Date-objekt et sted i strukturen? (cyklus-sikker) */
function containsDate(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((v) => containsDate(v, seen));
}

describe("countSeatUsage", () => {
  it("lægger medlemmer og gyldige invitationer sammen", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake af db-handle
    const usage = await countSeatUsage(fakeDb(5, 2) as any, "org-1");
    expect(usage).toEqual({ members: 5, pendingInvites: 2, total: 7 });
  });

  it("filtrerer på udløbsdato, så en udløben invitation ikke koster en plads", async () => {
    const db = fakeDb(5, 0);
    // biome-ignore lint/suspicious/noExplicitAny: minimal fake af db-handle
    const usage = await countSeatUsage(db as any, "org-1");
    expect(usage.total).toBe(5);
    // Invitations-queryen skal have en tidsgrænse med: uden den ville en
    // udløben invitation tælle som en optaget (og betalt) plads.
    expect(containsDate(db.calls)).toBe(true);
  });
});
