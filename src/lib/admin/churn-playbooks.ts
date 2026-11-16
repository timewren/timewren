import type { ChurnRiskUser } from "./churn-risk";

// Churn-playbooks (#152): deterministisk regel-motor — hvis score/
// betingelse matcher → handling. INGEN AI. V1-handlingen er Discord-
// alarm til founder (i en one-man-SaaS er den rettidige ping selve
// automatikken); email-aktioner kommer i fase 2 med admin-UI.

export interface ChurnPlaybook {
  key: string;
  label: string;
  /** Min. dage mellem udløsninger pr. bruger */
  cooldownDays: number;
  matches: (user: ChurnRiskUser) => boolean;
  /** Discord-beskeden der sendes når playbooken udløses */
  message: (user: ChurnRiskUser) => string;
}

export const CHURN_PLAYBOOKS: ChurnPlaybook[] = [
  {
    key: "high_risk_paying",
    label: "High-risk betalende kunde",
    cooldownDays: 14,
    matches: (u) =>
      u.riskLevel === "high" &&
      (u.subscriptionStatus === "active" ||
        u.subscriptionStatus === "past_due"),
    message: (u) =>
      `Betalende kunde i høj churn-risiko (score ${u.riskScore}): ${u.name} <${u.email}> — ${u.reasons.join("; ")}. Ræk ud personligt.`,
  },
  {
    key: "trial_stalling",
    label: "Trial stagnerer",
    cooldownDays: 7,
    matches: (u) =>
      u.subscriptionStatus === "trialing" &&
      u.riskScore >= 40 &&
      u.daysSinceLastEntry >= 5,
    message: (u) =>
      `Trial stagnerer (score ${u.riskScore}, ${u.daysSinceLastEntry} dage siden sidste registrering): ${u.name} <${u.email}>${u.trialEndsAt ? ` — trial udløber ${u.trialEndsAt.toLocaleDateString("da-DK", { timeZone: "Europe/Copenhagen" })}` : ""}. Overvej aktiveringshjælp.`,
  },
  {
    key: "past_due_inactive",
    label: "Past due + inaktiv",
    cooldownDays: 7,
    matches: (u) =>
      u.subscriptionStatus === "past_due" && u.daysSinceLastEntry >= 7,
    message: (u) =>
      `Betaling fejlet OG inaktiv i ${u.daysSinceLastEntry} dage: ${u.name} <${u.email}> — høj sandsynlighed for stille churn. Dunning kører; overvej personlig kontakt.`,
  },
];
