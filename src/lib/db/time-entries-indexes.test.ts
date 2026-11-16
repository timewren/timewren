import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { timeEntries } from "./schema";

// #1108: recurring_template_id er ikke en idempotens-nøgle. Den manuelle vej
// `recurring.generate` ("Brug Skabelon" / "Generer Nu") sætter den på hver
// post og må gerne lave flere poster for samme skabelon, kunde og dag. Et
// unikt indeks på kolonnen ville give en rå duplicate key-fejl ved andet tryk
// og kunne ikke oprettes i prod, hvor sådanne poster allerede findes.
// Cron'ens idempotens kommer fra én transaktion pr. skabelon (route.ts).
describe("time_entries indexes", () => {
  it("has no unique index that includes recurring_template_id", () => {
    const offending = getTableConfig(timeEntries)
      .indexes.filter((idx) => idx.config.unique)
      .filter((idx) =>
        idx.config.columns.some(
          (c) => "name" in c && c.name === "recurring_template_id",
        ),
      )
      .map((idx) => idx.config.name);
    expect(offending).toEqual([]);
  });
});
