import { and, eq } from "drizzle-orm";
import { getOpenAIForUser, isAIEnabledForUser } from "@/lib/ai/openai";
import { sanitizeForPrompt } from "@/lib/ai/sanitize";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";

export interface CustomerMatchResult {
  clientId: string | null;
  confidence: number;
  matchReason: string;
}

function extractDomain(email: string): string | null {
  const parts = email.toLowerCase().split("@");
  return parts.length === 2 ? parts[1] : null;
}

export async function matchCustomer(
  email: string,
  userId: string,
  options?: { skipAi?: boolean },
): Promise<CustomerMatchResult> {
  const normalized = email.trim().toLowerCase();

  // Exact email match
  const exact = await db.query.clients.findFirst({
    where: and(eq(clients.userId, userId), eq(clients.email, normalized)),
    columns: { id: true },
  });

  if (exact) {
    return { clientId: exact.id, confidence: 1, matchReason: "exact_email" };
  }

  const domain = extractDomain(normalized);
  if (!domain) {
    return { clientId: null, confidence: 0, matchReason: "no_domain" };
  }

  // Domain match on client email
  const allClients = await db.query.clients.findMany({
    where: eq(clients.userId, userId),
    columns: { id: true, email: true, company: true },
  });

  const domainMatch = allClients.find((client) => {
    const clientDomain = client.email ? extractDomain(client.email) : null;
    return clientDomain === domain;
  });

  if (domainMatch) {
    return {
      clientId: domainMatch.id,
      confidence: 0.9,
      matchReason: "email_domain",
    };
  }

  const companyMatch = allClients.find((client) => {
    const company = client.company?.toLowerCase();
    return company ? company.includes(domain) : false;
  });

  if (companyMatch) {
    return {
      clientId: companyMatch.id,
      confidence: 0.6,
      matchReason: "company_domain",
    };
  }

  if (!options?.skipAi) {
    const aiMatch = await aiPoweredMatch(email, userId, allClients);
    if (aiMatch) {
      return aiMatch;
    }
  }

  return { clientId: null, confidence: 0, matchReason: "no_match" };
}

async function aiPoweredMatch(
  email: string,
  userId: string,
  clientsList: { id: string; email: string | null; company: string | null }[],
): Promise<CustomerMatchResult | null> {
  if (!clientsList.length) {
    return null;
  }

  const aiEnabled = await isAIEnabledForUser(userId);
  if (!aiEnabled) {
    return null;
  }

  const { client, model } = await getOpenAIForUser(userId);
  const prompt = buildAIMatchPrompt(email, clientsList.slice(0, 50));

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: "Du matcher en email til en kunde. Svar KUN med JSON objekt.",
      },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 200,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as {
      clientId: string | null;
      confidence: number;
      reason?: string;
    };

    if (!parsed.clientId) return null;

    const safeConfidence = Math.max(0, Math.min(1, parsed.confidence || 0));
    return {
      clientId: parsed.clientId,
      confidence: safeConfidence,
      matchReason: parsed.reason || "ai_match",
    };
  } catch {
    return null;
  }
}

function buildAIMatchPrompt(
  senderEmail: string,
  clientsList: { id: string; email: string | null; company: string | null }[],
): string {
  const safeSenderEmail = sanitizeForPrompt(senderEmail, {
    maxLength: 254,
    allowNewlines: false,
    context: "customer_match_sender_email",
  });

  const list = clientsList
    .map(
      (client) =>
        `- id: ${client.id}, email: ${client.email || "n/a"}, company: ${
          client.company || "n/a"
        }`,
    )
    .join("\n");

  return `Matcher følgende sender-email til en kunde:\nEmail: ${safeSenderEmail}\n\nKunder:\n${list}\n\nSvar med JSON:\n{ "clientId": "id or null", "confidence": 0.0-1.0, "reason": "ai_match" }`;
}
