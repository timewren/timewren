import { expect, it } from "vitest";
import { recordsPDF } from "./pdf";

it("renders a downloadable PDF with Danish text and multiple pages", async () => {
  const blob = await recordsPDF(
    Array.from({ length: 100 }, (_, i) => ({
      id: String(i),
      date: new Date("2020-01-01Z"),
      description: "Øvelse på tværs",
      hours: "1.25",
    })),
    "2020",
  );
  expect(blob.type).toBe("application/pdf");
  expect(new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 4))).toBe(
    "%PDF",
  );
});
