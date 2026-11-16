import { and, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { emailClassificationCache } from "@/lib/db/schema";
import { getOpenAIForUser } from "./openai";
import { sanitizeForPrompt } from "./sanitize";

interface ClassificationResult {
  actionable: boolean;
  confidence: number;
}

/**
 * Quick AI classification for uncertain emails.
 * Uses GPT-4o-mini with minimal tokens for fast, cheap decisions.
 */
export async function aiQuickClassify(
  subject: string,
  bodyPreview: string,
  senderEmail: string,
  userId: string,
): Promise<ClassificationResult> {
  const { client, model } = await getOpenAIForUser(userId);

  const safeSender = sanitizeForPrompt(senderEmail, {
    maxLength: 254,
    allowNewlines: false,
  });
  const safeSubject = sanitizeForPrompt(subject, {
    maxLength: 500,
    allowNewlines: false,
  });
  const safePreview = sanitizeForPrompt(bodyPreview.slice(0, 300), {
    maxLength: 300,
    allowNewlines: true,
  });

  const prompt = `Er denne email relevant for en freelancer (kræver den handling)?

Fra: ${safeSender}
Emne: ${safeSubject}
Preview: ${safePreview}

Svar KUN med JSON: { "actionable": true/false, "confidence": 0.0-1.0 }`;

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `Du vurderer om emails kræver handling fra en dansk freelancer. Vær konservativ.

Actionable (true): Direkte kundeforespørgsler, opgavebeskrivelser, mødeindkaldelser, anmodninger om at gøre noget, feedback der kræver opfølgning, tilbud/kontrakter der skal besvares.

IKKE actionable (false): Nyhedsbreve, automatiske notifikationer, kvitteringer, ordrebekræftelser, reklame, out-of-office, WordPress/hosting alerts, marketing, SaaS opdateringer, uopfordrede cold emails, SEO/linkbuilding henvendelser, rekruttering, betalingsbekræftelser, two-factor koder, kalender-invitationer, ugentlige/månedlige rapporter.

Ved tvivl: vælg false med lav confidence.`,
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 100,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { actionable: true, confidence: 0.5 };
  }

  const parsed = JSON.parse(content) as ClassificationResult;
  return {
    actionable: parsed.actionable !== false,
    confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
  };
}

/**
 * Check cached classification for a sender domain.
 * Returns null if no valid cache entry or insufficient samples.
 */
export async function getCachedClassification(
  userId: string,
  senderDomain: string,
): Promise<ClassificationResult | null> {
  const cached = await db.query.emailClassificationCache.findFirst({
    where: and(
      eq(emailClassificationCache.userId, userId),
      eq(emailClassificationCache.senderDomain, senderDomain),
      gte(emailClassificationCache.expiresAt, new Date()),
    ),
  });

  if (!cached) return null;

  // Require 3+ samples before trusting cache
  if (cached.sampleCount < 3) return null;

  return {
    actionable: cached.isActionable,
    confidence: Number(cached.confidence) || 0.5,
  };
}

/**
 * Update the classification cache for a sender domain.
 */
export async function updateClassificationCache(
  userId: string,
  senderDomain: string,
  isActionable: boolean,
  confidence: number,
): Promise<void> {
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const existing = await db.query.emailClassificationCache.findFirst({
    where: and(
      eq(emailClassificationCache.userId, userId),
      eq(emailClassificationCache.senderDomain, senderDomain),
    ),
  });

  if (existing) {
    // Running average: cap previous weight at 10 to allow drift over time
    const prevWeight = Math.min(existing.sampleCount, 10);
    const totalWeight = prevWeight + 1;
    const prevConfidence = Number(existing.confidence) || 0.5;
    const newConfidence =
      (prevConfidence * prevWeight + confidence) / totalWeight;
    const newActionable = newConfidence >= 0.5;

    await db
      .update(emailClassificationCache)
      .set({
        isActionable: newActionable,
        confidence: String(Number.parseFloat(newConfidence.toFixed(3))),
        sampleCount: existing.sampleCount + 1,
        expiresAt: sevenDaysFromNow,
      })
      .where(
        and(
          eq(emailClassificationCache.id, existing.id),
          eq(emailClassificationCache.userId, userId),
        ),
      );
  } else {
    await db
      .insert(emailClassificationCache)
      .values({
        userId,
        senderDomain,
        isActionable,
        confidence: String(confidence),
        sampleCount: 1,
        expiresAt: sevenDaysFromNow,
      })
      .onConflictDoNothing();
  }
}
