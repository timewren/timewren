import { createElement } from "react";
import { ToolGuideEmail } from "@/components/email/ToolGuideEmail";
import { getMarketingUrl } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { renderEmail } from "./render-email";

/**
 * Guide-mail til leads fra gratis værktøjer ("få resultatet + guiden på
 * mail"). Én mail pr. capture — drip-opfølgning kan bygges ovenpå
 * marketing_leads senere.
 */

export const TOOL_GUIDES: Record<
  string,
  { name: string; guidePath: string; guideLabel: string }
> = {
  "timepris-beregner": {
    name: "Timepris-beregneren",
    guidePath: "/blog/freelancer-timepris-2026",
    guideLabel: "Guide: Timepriser for freelancere i 2026",
  },
  "minutter-til-timer": {
    name: "Minutter til timer-omregneren",
    guidePath: "/blog/timeregistrering-freelancer-guide",
    guideLabel: "Guide: Timeregistrering for freelancere",
  },
  "daekningsgrad-beregner": {
    name: "Dækningsgrad-beregneren",
    guidePath: "/blog/freelancer-timepris-2026",
    guideLabel: "Guide: Timepriser for freelancere i 2026",
  },
  "belaegningsgrad-beregner": {
    name: "Belægningsgrad-beregneren",
    guidePath: "/blog/freelancer-timepris-2026",
    guideLabel: "Guide: Timepriser for freelancere i 2026",
  },
  "timepris-haandvaerker": {
    name: "Timepris-beregneren for håndværkere",
    guidePath: "/timeregistrering-haandvaerker",
    guideLabel: "Guide: Timeregistrering for håndværkere",
  },
  "timeloen-beregner": {
    name: "Timeløn-beregneren",
    guidePath: "/blog/freelancer-timepris-2026",
    guideLabel: "Guide: Timepriser for freelancere i 2026",
  },
  "moms-beregner": {
    name: "Moms-beregneren",
    guidePath: "/blog/fakturering-fejl-freelancer",
    guideLabel: "Guide: De typiske faktureringsfejl (og hvordan du undgår dem)",
  },
  "faktura-skabelon": {
    name: "Faktura-skabelonen",
    guidePath: "/blog/fakturering-fejl-freelancer",
    guideLabel: "Guide: De typiske faktureringsfejl (og hvordan du undgår dem)",
  },
  "arbejdstimer-beregner": {
    name: "Arbejdstimer-beregneren",
    guidePath: "/blog/timeregistrering-freelancer-guide",
    guideLabel: "Guide: Timeregistrering for freelancere",
  },
  "ugentlig-timerapport": {
    name: "Den ugentlige timerapport",
    guidePath: "/blog/excel-til-timerapport",
    guideLabel: "Guide: Fra Excel til automatisk timerapport",
  },
  "freelance-budget": {
    name: "Freelance-budgettet",
    guidePath: "/blog/freelancer-timepris-2026",
    guideLabel: "Guide: Timepriser for freelancere i 2026",
  },
  "projekt-deadline-beregner": {
    name: "Projekt-deadline-beregneren",
    guidePath: "/blog/timeregistrering-freelancer-guide",
    guideLabel: "Guide: Timeregistrering for freelancere",
  },
  "klient-timer-oversigt": {
    name: "Timeoversigten pr. kunde",
    guidePath: "/blog/klippekort-freelancer",
    guideLabel: "Guide: Klippekort for freelancere",
  },
  skabeloner: {
    name: "Skabelon-biblioteket",
    guidePath: "/blog/fakturering-fejl-freelancer",
    guideLabel: "Guide: De typiske faktureringsfejl (og hvordan du undgår dem)",
  },
  "freelance-health-check": {
    name: "Freelance Health Check",
    guidePath: "/blog/timeregistrering-freelancer-guide",
    guideLabel: "Guide: Timeregistrering for freelancere",
  },
  "klippekort-prisberegner": {
    name: "Klippekort-prisberegneren",
    guidePath: "/blog/klippekort-freelancer",
    guideLabel: "Guide: Klippekort for freelancere",
  },
  "hidden-cost-calculator": {
    name: "Ufaktureret tid-beregneren",
    guidePath: "/blog/timeregistrering-freelancer-guide",
    guideLabel: "Guide: Timeregistrering for freelancere",
  },
};

export async function sendToolGuideEmail({
  to,
  tool,
}: {
  to: string;
  tool: string;
}) {
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured, tool-guide mail dropped");
    return;
  }
  const guide = TOOL_GUIDES[tool];
  if (!guide) return;

  // Leads fra de gratis værktøjer har ingen profil: dansk, som værktøjerne.
  const locale = "da";
  const t = mailT("emailsDrip", locale);
  const base = getMarketingUrl();
  const toolUrl = `${base}/${tool === "hidden-cost-calculator" ? "ufaktureret-tid-beregner" : tool}`;
  const guideUrl = `${base}${guide.guidePath}`;

  const { html, text } = await renderEmail(
    createElement(ToolGuideEmail, {
      locale,
      toolName: guide.name,
      guideLabel: guide.guideLabel,
      guideUrl,
      toolUrl,
      trialUrl: `${base}/?utm_source=tool-guide-mail&utm_medium=email&utm_campaign=${tool}`,
    }),
  );

  await resend.emails.send({
    from: DEFAULT_FROM_EMAIL,
    to,
    subject: t("toolGuide.subject", { tool: guide.name }),
    html,
    text,
  });
}
