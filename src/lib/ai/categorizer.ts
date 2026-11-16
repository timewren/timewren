import {
  DEFAULT_MODEL,
  getOpenAI,
  getOpenAIForUser,
  isAIEnabled,
  isAIEnabledForUser,
} from "./openai";
import {
  buildSafePrompt,
  detectInjectionAttempt,
  sanitizeEmail,
  sanitizeList,
} from "./sanitize";

const CATEGORIZATION_SYSTEM_PROMPT = `Du er en intelligent assistent der hjælper freelancere med at kategorisere opgaver.
Din opgave er at matche en opgave med det mest relevante projekt og klient baseret på kontekst.

Analyser opgavens titel, beskrivelse og eventuel afsender-information, og match det med de tilgængelige projekter og klienter.

Overvej:
1. Nøgleord i opgaven der matcher projekt/klient navne
2. Domæner i email-adresser (fx @acme.com matcher Acme klient)
3. Branchemæssig kontekst (fx "design" matcher design-projekter)
4. Historiske mønstre hvis tilgængelig

VIGTIGT: Svar KUN med valid JSON. Ingen markdown, ingen forklaringer.`;

const CATEGORIZATION_USER_TEMPLATE = `Kategoriser følgende opgave:

Opgave:
- Titel: {title}
- Beskrivelse: {description}
- Afsender: {sender}

Tilgængelige projekter:
{projects}

Tilgængelige klienter:
{clients}

Svar med JSON i dette format:
{
  "suggestedProjectId": "string | null",
  "suggestedProjectName": "string | null",
  "projectConfidence": 0.0-1.0,
  "suggestedClientId": "string | null",
  "suggestedClientName": "string | null",
  "clientConfidence": 0.0-1.0,
  "suggestedTags": ["string"],
  "reasoning": "kort forklaring"
}`;

export interface Project {
  id: string;
  name: string;
  clientId: string | null;
  clientName?: string;
  description?: string | null;
}

export interface Client {
  id: string;
  name: string;
  email?: string | null;
  domain?: string | null;
}

export interface CategorizationInput {
  title: string;
  description?: string | null;
  sender?: string | null;
}

export interface CategorizationResult {
  suggestedProjectId: string | null;
  suggestedProjectName: string | null;
  projectConfidence: number;
  suggestedClientId: string | null;
  suggestedClientName: string | null;
  clientConfidence: number;
  suggestedTags: string[];
  reasoning: string;
}

/**
 * Categorize a task by suggesting matching project and client
 * @param input - The task to categorize
 * @param projects - Available projects
 * @param clients - Available clients
 * @param userId - Optional user ID for user-specific AI configuration
 */
export async function categorizeTask(
  input: CategorizationInput,
  projects: Project[],
  clients: Client[],
  userId?: string,
): Promise<CategorizationResult> {
  // If no projects or clients, return empty result
  if (projects.length === 0 && clients.length === 0) {
    return emptyResult("Ingen projekter eller klienter tilgængelige");
  }

  // First try keyword matching (fast, no AI)
  const keywordMatch = keywordBasedCategorization(input, projects, clients);
  if (
    keywordMatch.projectConfidence >= 0.8 ||
    keywordMatch.clientConfidence >= 0.8
  ) {
    return keywordMatch;
  }

  // Check if AI is enabled (user-specific or system-level)
  const aiEnabled = userId ? await isAIEnabledForUser(userId) : isAIEnabled();
  if (!aiEnabled) {
    return keywordMatch;
  }

  try {
    // Check for potential prompt injection attempts
    if (
      detectInjectionAttempt(input.title) ||
      detectInjectionAttempt(input.description || "")
    ) {
      console.warn(
        "Potential prompt injection attempt detected in categorization",
      );
    }

    // Format projects for the prompt (sanitized, limited)
    // Only include name and ID, not descriptions that could contain sensitive info
    const projectsText = sanitizeList(
      projects.slice(0, 50), // Limit to 50 projects to control token usage
      (p) =>
        `- ${p.name} (ID: ${p.id})${p.clientName ? ` [Klient: ${p.clientName}]` : ""}`,
      50,
    );

    // Format clients for the prompt (sanitized, NO full emails - only domains for privacy)
    const clientsText = sanitizeList(
      clients.slice(0, 50), // Limit to 50 clients
      (c) =>
        `- ${c.name} (ID: ${c.id})${c.domain ? ` [Domæne: ${c.domain}]` : ""}`,
      50,
    );

    // Build prompt with sanitized values
    const userPrompt = buildSafePrompt(CATEGORIZATION_USER_TEMPLATE, {
      title: input.title,
      description: input.description || "Ingen beskrivelse",
      sender: input.sender ? sanitizeEmail(input.sender) : "Ukendt", // Only send domain part
      projects: projectsText || "Ingen projekter",
      clients: clientsText || "Ingen klienter",
    });

    // Get AI client (user-specific or system-level)
    const { client, model } = userId
      ? await getOpenAIForUser(userId)
      : { client: getOpenAI(), model: DEFAULT_MODEL };

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: CATEGORIZATION_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }

    const parsed = JSON.parse(content) as CategorizationResult;

    // Validate project ID exists
    if (
      parsed.suggestedProjectId &&
      !projects.find((p) => p.id === parsed.suggestedProjectId)
    ) {
      parsed.suggestedProjectId = null;
      parsed.suggestedProjectName = null;
      parsed.projectConfidence = 0;
    }

    // Validate client ID exists
    if (
      parsed.suggestedClientId &&
      !clients.find((c) => c.id === parsed.suggestedClientId)
    ) {
      parsed.suggestedClientId = null;
      parsed.suggestedClientName = null;
      parsed.clientConfidence = 0;
    }

    return {
      suggestedProjectId: parsed.suggestedProjectId || null,
      suggestedProjectName: parsed.suggestedProjectName || null,
      projectConfidence: Math.min(
        1,
        Math.max(0, parsed.projectConfidence || 0),
      ),
      suggestedClientId: parsed.suggestedClientId || null,
      suggestedClientName: parsed.suggestedClientName || null,
      clientConfidence: Math.min(1, Math.max(0, parsed.clientConfidence || 0)),
      suggestedTags: Array.isArray(parsed.suggestedTags)
        ? parsed.suggestedTags
        : [],
      reasoning: parsed.reasoning || "",
    };
  } catch (error) {
    console.error("AI categorization failed:", error);
    return keywordMatch;
  }
}

/**
 * Fast keyword-based categorization without AI
 */
function keywordBasedCategorization(
  input: CategorizationInput,
  projects: Project[],
  clients: Client[],
): CategorizationResult {
  const searchText =
    `${input.title} ${input.description || ""} ${input.sender || ""}`.toLowerCase();

  let bestProject: Project | null = null;
  let bestProjectScore = 0;

  let bestClient: Client | null = null;
  let bestClientScore = 0;

  // Match projects
  for (const project of projects) {
    let score = 0;
    const projectName = project.name.toLowerCase();

    // Exact name match
    if (searchText.includes(projectName)) {
      score += 0.8;
    }

    // Word-by-word match
    const words = projectName.split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && searchText.includes(word)) {
        score += 0.3;
      }
    }

    if (score > bestProjectScore) {
      bestProjectScore = score;
      bestProject = project;
    }
  }

  // Match clients
  for (const client of clients) {
    let score = 0;
    const clientName = client.name.toLowerCase();

    // Exact name match
    if (searchText.includes(clientName)) {
      score += 0.8;
    }

    // Domain match in sender email
    if (
      client.domain &&
      input.sender?.toLowerCase().includes(client.domain.toLowerCase())
    ) {
      score += 0.9;
    }

    // Email match
    if (
      client.email &&
      input.sender?.toLowerCase() === client.email.toLowerCase()
    ) {
      score += 1.0;
    }

    // Word-by-word match
    const words = clientName.split(/\s+/);
    for (const word of words) {
      if (word.length > 2 && searchText.includes(word)) {
        score += 0.3;
      }
    }

    if (score > bestClientScore) {
      bestClientScore = score;
      bestClient = client;
    }
  }

  // If we matched a project, use its client
  if (bestProject?.clientId && !bestClient) {
    bestClient = clients.find((c) => c.id === bestProject?.clientId) || null;
    if (bestClient) {
      bestClientScore = Math.min(bestProjectScore, 0.7);
    }
  }

  return {
    suggestedProjectId: bestProject?.id || null,
    suggestedProjectName: bestProject?.name || null,
    projectConfidence: Math.min(1, bestProjectScore),
    suggestedClientId: bestClient?.id || null,
    suggestedClientName: bestClient?.name || null,
    clientConfidence: Math.min(1, bestClientScore),
    suggestedTags: [],
    reasoning: "Keyword-baseret matching",
  };
}

/**
 * Empty categorization result
 */
function emptyResult(reasoning: string): CategorizationResult {
  return {
    suggestedProjectId: null,
    suggestedProjectName: null,
    projectConfidence: 0,
    suggestedClientId: null,
    suggestedClientName: null,
    clientConfidence: 0,
    suggestedTags: [],
    reasoning,
  };
}
