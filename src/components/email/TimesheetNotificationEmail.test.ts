import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { TimesheetNotificationEmail } from "./TimesheetNotificationEmail";

const base = {
  recipientName: "Modtager",
  heading: "Tid til godkendelse",
  bodyLines: ["Der er sendt tid til godkendelse."],
  ctaLabel: "Åbn godkendelser",
  ctaUrl: "https://app.timetrack.dk/portal/approvals",
};

async function text(
  props: Partial<Parameters<typeof TimesheetNotificationEmail>[0]>,
) {
  return render(
    createElement(TimesheetNotificationEmail, { ...base, ...props }),
    {
      plainText: true,
    },
  );
}

describe("TimesheetNotificationEmail sidefod", () => {
  it("bruger systemsidefoden, når mailen går til en bruger", async () => {
    const t = await text({});
    expect(t).toContain("du har en konto på TimeTrack");
    expect(t).toContain("Mailindstillinger");
    expect(t).toContain("CVR 39413892");
    expect(t).not.toContain("Sendt via");
  });

  it("bruger en neutral sidefod, når mailen går til brugerens kunde", async () => {
    const t = await text({
      toCustomer: true,
      footerNote:
        "Du får denne mail, fordi Afsender har sendt tid til godkendelse.",
    });
    expect(t).toContain("Sendt via");
    expect(t).toContain("Afsender har sendt tid til godkendelse");
    expect(t).not.toContain("du har en konto på TimeTrack");
    expect(t).not.toContain("Mailindstillinger");
    expect(t).not.toContain("CVR 39413892");
  });
});
