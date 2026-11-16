import { and, eq, gte, lt } from "drizzle-orm";
import { timeEntries } from "@/lib/db/schema";

export function recordsFilter(
  userId: string,
  orgId: string,
  input: { year: number; month?: number },
) {
  const month = input.month ?? 1;
  return and(
    eq(timeEntries.userId, userId),
    eq(timeEntries.organizationId, orgId),
    gte(timeEntries.date, new Date(Date.UTC(input.year, month - 1, 1))),
    lt(
      timeEntries.date,
      new Date(
        Date.UTC(
          input.year + (input.month ? 0 : 1),
          input.month ? month : 0,
          1,
        ),
      ),
    ),
  );
}
