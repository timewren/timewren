import {
  DEFAULT_MODEL,
  getOpenAI,
  getOpenAIForUser,
  isAIEnabled,
  isAIEnabledForUser,
} from "./openai";
import { buildSafePrompt, detectInjectionAttempt } from "./sanitize";

const TIME_ESTIMATION_SYSTEM_PROMPT = `Du er en erfaren freelancer der hjælper med at estimere tid for opgaver.
Din opgave er at give realistiske tidsestimater baseret på opgavens kompleksitet.

Standard estimater (brug som udgangspunkt):
- Simpel kommunikation (email, sms, opkald): 15-30 min
- Kort møde: 30-60 min
- Langt møde/workshop: 90-180 min
- Research/undersøgelse: 60-180 min
- Simpel dokumentation: 30-60 min
- Kompleks dokumentation: 120-240 min
- Simpel bugfix: 30-60 min
- Kompleks bugfix: 120-480 min
- Ny feature (lille): 120-240 min
- Ny feature (stor): 480-960 min
- Design (mockup): 60-120 min
- Design (komplet): 240-480 min
- Review/QA: 30-90 min
- Deployment: 30-60 min
- Database-arbejde: 60-180 min

Juster estimater baseret på:
- Beskrivelsens detaljegrad (mere detalje = mere præcist)
- Kompleksitetsindikatorer ("simpel", "kompleks", "omfattende")
- Domænespecifikke nøgleord
- Historiske data hvis tilgængelig

VIGTIGT: Svar KUN med valid JSON. Ingen markdown, ingen forklaringer.`;

const TIME_ESTIMATION_USER_TEMPLATE = `Estimér tid for følgende opgave:

Titel: {title}
Beskrivelse: {description}
Projekt-type: {projectType}

{historicalContext}

Svar med JSON i dette format:
{
  "estimatedMinutes": number,
  "confidence": 0.0-1.0,
  "breakdown": [
    { "activity": "string", "minutes": number }
  ],
  "reasoning": "kort forklaring"
}`;

export interface TimeEstimationInput {
  title: string;
  description?: string | null;
  projectType?: string | null;
  historicalAverage?: number | null;
}

export interface TimeBreakdown {
  activity: string;
  minutes: number;
}

export interface TimeEstimationResult {
  estimatedMinutes: number;
  confidence: number;
  breakdown: TimeBreakdown[];
  reasoning: string;
}

/**
 * Keyword patterns for estimation
 */
const ESTIMATION_PATTERNS: {
  pattern: RegExp;
  minutes: number;
  confidence: number;
}[] = [
  // Communication
  { pattern: /\b(email|mail|besked)\b/i, minutes: 15, confidence: 0.7 },
  { pattern: /\b(ring|opkald|telefon)\b/i, minutes: 20, confidence: 0.7 },
  { pattern: /\b(sms|tekst)\b/i, minutes: 10, confidence: 0.8 },

  // Meetings
  { pattern: /\b(møde|meeting)\b/i, minutes: 60, confidence: 0.6 },
  { pattern: /\b(workshop)\b/i, minutes: 180, confidence: 0.5 },
  { pattern: /\b(præsentation|demo)\b/i, minutes: 90, confidence: 0.5 },

  // Development
  { pattern: /\b(bugfix|fejlrettelse|bug)\b/i, minutes: 60, confidence: 0.4 },
  {
    pattern: /\b(feature|funktion|implementer)\b/i,
    minutes: 180,
    confidence: 0.3,
  },
  { pattern: /\b(refactor|omstruktur)\b/i, minutes: 120, confidence: 0.4 },
  { pattern: /\b(deploy|release|udrulning)\b/i, minutes: 45, confidence: 0.6 },
  { pattern: /\b(test|testing)\b/i, minutes: 60, confidence: 0.5 },
  { pattern: /\b(code review|review)\b/i, minutes: 45, confidence: 0.6 },

  // Design
  { pattern: /\b(design|mockup|wireframe)\b/i, minutes: 120, confidence: 0.4 },
  { pattern: /\b(logo|grafik|billede)\b/i, minutes: 90, confidence: 0.4 },
  { pattern: /\b(UI|UX|interface)\b/i, minutes: 150, confidence: 0.3 },

  // Documentation
  {
    pattern: /\b(dokumentation|dokumenter|skriv)\b/i,
    minutes: 60,
    confidence: 0.5,
  },
  { pattern: /\b(rapport|analyse)\b/i, minutes: 120, confidence: 0.4 },

  // Research
  {
    pattern: /\b(research|undersøg|find ud af)\b/i,
    minutes: 90,
    confidence: 0.4,
  },
  { pattern: /\b(evaluér|vurdér)\b/i, minutes: 60, confidence: 0.5 },

  // Complexity modifiers
  { pattern: /\b(simpel|let|hurtig|quick)\b/i, minutes: -30, confidence: 0.1 },
  { pattern: /\b(kompleks|svær|omfattende)\b/i, minutes: 60, confidence: 0.1 },
  { pattern: /\b(stor|major|stor)\b/i, minutes: 120, confidence: 0.1 },
];

/**
 * Estimate time for a task using keyword matching (fast, no AI)
 */
export function keywordEstimation(
  input: TimeEstimationInput,
): TimeEstimationResult {
  const text = `${input.title} ${input.description || ""}`.toLowerCase();

  let baseMinutes = 60; // Default 1 hour
  let totalConfidence = 0;
  let matchCount = 0;
  const breakdown: TimeBreakdown[] = [];

  for (const { pattern, minutes, confidence } of ESTIMATION_PATTERNS) {
    if (pattern.test(text)) {
      if (minutes > 0) {
        breakdown.push({
          activity: pattern.source.replace(/\\b|\(|\)/g, "").split("|")[0],
          minutes,
        });
        baseMinutes = Math.max(baseMinutes, minutes);
      } else {
        baseMinutes += minutes; // Modifier
      }
      totalConfidence += confidence;
      matchCount++;
    }
  }

  // Use historical average if available and more confident
  if (input.historicalAverage && input.historicalAverage > 0) {
    baseMinutes = Math.round((baseMinutes + input.historicalAverage) / 2);
    totalConfidence += 0.3;
  }

  // Normalize confidence
  const finalConfidence = Math.min(
    0.7,
    matchCount > 0 ? totalConfidence / matchCount : 0.3,
  );

  // Ensure minimum 15 minutes
  baseMinutes = Math.max(15, baseMinutes);

  // Round to nearest 15 minutes
  baseMinutes = Math.round(baseMinutes / 15) * 15;

  return {
    estimatedMinutes: baseMinutes,
    confidence: finalConfidence,
    breakdown:
      breakdown.length > 0
        ? breakdown
        : [{ activity: "Generelt arbejde", minutes: baseMinutes }],
    reasoning:
      matchCount > 0
        ? `Baseret på ${matchCount} keyword-match${matchCount > 1 ? "es" : ""}`
        : "Standard estimat (ingen specifikke keywords fundet)",
  };
}

/**
 * Estimate time for a task using AI
 * @param input - The task to estimate
 * @param userId - Optional user ID for user-specific AI configuration
 */
export async function estimateTaskTime(
  input: TimeEstimationInput,
  userId?: string,
): Promise<TimeEstimationResult> {
  // Always start with keyword estimation
  const keywordResult = keywordEstimation(input);

  // Check if AI is enabled (user-specific or system-level)
  const aiEnabled = userId ? await isAIEnabledForUser(userId) : isAIEnabled();

  // If AI not enabled or confidence is high, return keyword result
  if (!aiEnabled || keywordResult.confidence >= 0.6) {
    return keywordResult;
  }

  try {
    // Check for potential prompt injection
    if (
      detectInjectionAttempt(input.title) ||
      detectInjectionAttempt(input.description || "")
    ) {
      console.warn(
        "Potential prompt injection attempt detected in time estimation",
      );
    }

    const historicalContext = input.historicalAverage
      ? `Historisk gennemsnit for lignende opgaver: ${input.historicalAverage} minutter`
      : "Ingen historiske data tilgængelig";

    // Build prompt with sanitized values
    const userPrompt = buildSafePrompt(TIME_ESTIMATION_USER_TEMPLATE, {
      title: input.title,
      description: input.description || "Ingen beskrivelse",
      projectType: input.projectType || "Ukendt",
      historicalContext: historicalContext,
    });

    // Get AI client (user-specific or system-level)
    const { client, model } = userId
      ? await getOpenAIForUser(userId)
      : { client: getOpenAI(), model: DEFAULT_MODEL };

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: TIME_ESTIMATION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 400,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content) as TimeEstimationResult;

    // Validate and normalize
    let estimatedMinutes =
      parsed.estimatedMinutes || keywordResult.estimatedMinutes;
    estimatedMinutes = Math.max(15, Math.min(2880, estimatedMinutes)); // 15 min to 48 hours
    estimatedMinutes = Math.round(estimatedMinutes / 15) * 15; // Round to 15 min

    return {
      estimatedMinutes,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      breakdown:
        Array.isArray(parsed.breakdown) && parsed.breakdown.length > 0
          ? parsed.breakdown
          : keywordResult.breakdown,
      reasoning: parsed.reasoning || keywordResult.reasoning,
    };
  } catch (error) {
    console.error("AI time estimation failed:", error);
    return keywordResult;
  }
}

/**
 * Update estimation based on actual time (for learning)
 */
export function calculateAccuracy(
  estimatedMinutes: number,
  actualMinutes: number,
): { accuracy: number; wasUnderestimate: boolean; differenceMinutes: number } {
  const difference = actualMinutes - estimatedMinutes;
  const accuracy =
    1 - Math.abs(difference) / Math.max(estimatedMinutes, actualMinutes);

  return {
    accuracy: Math.max(0, Math.min(1, accuracy)),
    wasUnderestimate: difference > 0,
    differenceMinutes: difference,
  };
}

/**
 * Format minutes as human-readable string
 */
export function formatEstimate(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours} time${hours > 1 ? "r" : ""}`;
  }

  return `${hours} time${hours > 1 ? "r" : ""} ${remainingMinutes} min`;
}
