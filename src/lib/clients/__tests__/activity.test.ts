import { describe, expect, it } from "vitest";
import { isInactiveClient } from "../activity";

const now = new Date("2026-11-22T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000);

describe("isInactiveClient", () => {
  it("does not count a client created today as inactive", () => {
    // Fund 13: en nyoprettet kunde stod både under "Aktive" og "Inaktive".
    expect(
      isInactiveClient(
        { createdAt: daysAgo(0), stats: { lastActivityDate: null } },
        now,
      ),
    ).toBe(false);
  });

  it("counts a client without any time after 30 days as inactive", () => {
    expect(
      isInactiveClient(
        { createdAt: daysAgo(31), stats: { lastActivityDate: null } },
        now,
      ),
    ).toBe(true);
  });

  it("uses the last time entry when there is one", () => {
    expect(
      isInactiveClient(
        { createdAt: daysAgo(400), stats: { lastActivityDate: daysAgo(3) } },
        now,
      ),
    ).toBe(false);
    expect(
      isInactiveClient(
        { createdAt: daysAgo(400), stats: { lastActivityDate: daysAgo(45) } },
        now,
      ),
    ).toBe(true);
  });

  it("never counts an archived client as inactive", () => {
    expect(
      isInactiveClient(
        {
          isArchived: true,
          createdAt: daysAgo(400),
          stats: { lastActivityDate: null },
        },
        now,
      ),
    ).toBe(false);
  });

  it("keeps the old behaviour when the creation date is unknown", () => {
    expect(isInactiveClient({ stats: { lastActivityDate: null } }, now)).toBe(
      true,
    );
  });
});
