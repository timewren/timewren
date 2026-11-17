import { describe, expect, it } from "vitest";
import { reaches } from "@/test/import-graph";

// useTimerSync kører i dashboardets skal (116 ruter). Når den når
// databaseskemaet, kommer hele skemaet og drizzle-orm med i klientbundtet.
describe("timer-synk i browseren", () => {
  it("vagten kan se skemaet bag SQL-prædikaterne", () => {
    expect(reaches("lib/timer/resurrection.ts", "lib/db/schema.ts")).toBe(true);
  });

  it("useTimerSync importerer ikke databaseskemaet", () => {
    expect(reaches("hooks/useTimerSync.ts", "lib/db/schema.ts")).toBe(false);
  });
});
