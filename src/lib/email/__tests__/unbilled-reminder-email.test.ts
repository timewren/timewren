import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { UnbilledReminderEmail } from "@/components/email/UnbilledReminderEmail";

const renderEmail = (frequency: "daily" | "weekly" | "monthly") =>
  render(
    createElement(UnbilledReminderEmail, {
      userName: "Mads Holst Jensen",
      totalUnbilledHours: 12.5,
      totalUnbilledValue: 10000,
      unbilledByClient: [{ name: "Eksempel ApS", hours: 12.5, value: 10000 }],
      frequency,
    }),
  );

describe("UnbilledReminderEmail", () => {
  it("hilser uden mellemrum før kommaet", async () => {
    const html = await renderEmail("weekly");
    expect(html).toContain("Hej Mads Holst Jensen,");
    expect(html).not.toContain("Mads Holst Jensen ,");
  });

  it("footer-teksten følger kadencen", async () => {
    expect(await renderEmail("daily")).toContain(
      "Påmindelsen sendes hver hverdag.",
    );
    expect(await renderEmail("weekly")).toContain(
      "Påmindelsen sendes hver fredag.",
    );
    expect(await renderEmail("monthly")).toContain(
      "Påmindelsen sendes sidst på måneden.",
    );
  });
});
