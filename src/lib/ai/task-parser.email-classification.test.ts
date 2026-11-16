import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { classifyEmail } from "./task-parser";

describe("classifyEmail — automatiske kundeeksporter", () => {
  it("opretter ikke en opgave for leverandørens daterede ordreeksport", () => {
    const result = classifyEmail({
      from: "hej@example.dk",
      subject: "Eksempel ordre-eksport 01-08-2026",
      body: "Vedhæftet er den automatiske ordreeksport for dagen.",
    });

    expect(result.isActionable).toBe(false);
  });
});
