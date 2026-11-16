import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrepaidForecast } from "./PrepaidForecast";

const props = {
  createdAt: new Date("2026-09-01"),
  remainingHours: 20,
  now: new Date("2026-11-02T12:00:00Z"),
  isActive: true,
  usage: [{ createdAt: new Date("2026-11-01"), hoursUsed: "30" }],
};

describe("PrepaidForecast", () => {
  it("renders a Danish estimate, method, and accessible daily table", () => {
    const html = renderToStaticMarkup(<PrepaidForecast {...props} />);
    expect(html).toContain("7 timer pr. uge");
    expect(html).toContain("om ca. 20 dage");
    expect(html).toContain("22. nov. 2026");
    expect(html).toContain("inklusive dage uden forbrug");
    expect(html).toContain('scope="col"');
    expect(html).toContain("uden fremtidige optankninger eller fornyelser");
  });
  it("explains missing data instead of displaying a fictitious date", () => {
    const html = renderToStaticMarkup(
      <PrepaidForecast {...props} usage={[]} />,
    );
    expect(html).toContain("Intet forbrug i perioden");
    expect(html).not.toContain("om ca.");
  });
  it("warns about expiry and shows no estimate for inactive cards", () => {
    const expiry = renderToStaticMarkup(
      <PrepaidForecast {...props} expiryDate={new Date("2026-11-03")} />,
    );
    expect(expiry).toContain("før den forventede slutdato");
    const inactive = renderToStaticMarkup(
      <PrepaidForecast {...props} isActive={false} />,
    );
    expect(inactive).toContain("Kortet er deaktiveret");
    expect(inactive).not.toContain("om ca.");
  });
});
