import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  deadlineRecipientIs,
  resolveDeadlineRecipient,
} from "./deadline-recipient";

const CREATOR = "user-creator";
const ASSIGNEE = "user-assignee";

/**
 * Deadline-påmindelser skal ramme den der SKAL lave opgaven (#211). Solo-
 * brugere er både opretter og (implicit) tildelt, så fallback til opretteren
 * holder dem upåvirkede.
 */
describe("resolveDeadlineRecipient", () => {
  it("sender til den tildelte når opgaven er tildelt", () => {
    expect(
      resolveDeadlineRecipient({ userId: CREATOR, assignedToUserId: ASSIGNEE }),
    ).toBe(ASSIGNEE);
  });

  it("falder tilbage til opretteren når ingen er tildelt", () => {
    expect(
      resolveDeadlineRecipient({ userId: CREATOR, assignedToUserId: null }),
    ).toBe(CREATOR);
  });

  it("er identisk for solo-brugere (opretter = tildelt)", () => {
    expect(
      resolveDeadlineRecipient({ userId: CREATOR, assignedToUserId: CREATOR }),
    ).toBe(CREATOR);
  });
});

describe("deadlineRecipientIs", () => {
  it("matcher tildelte opgaver, og kun utildelte på opretter", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      deadlineRecipientIs(ASSIGNEE),
    );
    expect(sql).toContain('"assigned_to_user_id" = $1');
    expect(sql).toContain('"assigned_to_user_id" is null');
    expect(sql).toContain('"user_id" = $2');
    expect(params).toEqual([ASSIGNEE, ASSIGNEE]);
  });
});
