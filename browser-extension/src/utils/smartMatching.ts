import { t } from "../i18n/core";

/**
 * Smart matching utilities for customer/project detection
 * Matches website domains and page titles with customer and project names
 */

interface MatchResult {
  type: "client" | "project";
  id: string;
  name: string;
  confidence: number;
  matchReason: string;
}

interface Client {
  id: string;
  name: string;
  customDomain?: string | null;
}

interface Project {
  id: string;
  name: string;
  clientId: string;
}

/**
 * Normalize text for matching (lowercase, remove special chars, etc.).
 * Bogstaver uden for a-z (æ, ø, å, é …) bevares — før blev "Bageriet på
 * hjørnet" til "bageriet p hjrnet" og matchede aldrig noget.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Danske bogstaver skrives på to måder i domæner og URL'er: æ/ø/å som
 * ae/oe/aa ("hjoernet") eller som a/o/a ("hjornet"). Begge stavemåder
 * sammenlignes.
 */
function foldDanish(text: string, variant: "double" | "single"): string {
  const map =
    variant === "double"
      ? { æ: "ae", ø: "oe", å: "aa" }
      : { æ: "a", ø: "o", å: "a" };
  return text
    .normalize("NFC")
    .replace(/[æøå]/g, (ch) => map[ch as "æ" | "ø" | "å"]);
}

/** Kompakt nøgle uden mellemrum og tegn, i begge stavemåder. */
function compactKeys(text: string): string[] {
  const compact = normalizeText(text).replace(/\s/g, "");
  const keys = new Set([
    foldDanish(compact, "double"),
    foldDanish(compact, "single"),
  ]);
  return [...keys].filter(Boolean);
}

/**
 * Domæner med æøå (fx "hjørnet.dk") kommer fra browseren som punycode
 * ("xn--hjrnet-zua.dk"). Afkod labels med "xn--" (RFC 3492) — uden pakke.
 */
export function decodePunycodeLabel(label: string): string {
  if (!label.toLowerCase().startsWith("xn--")) return label;
  const input = label.slice(4).toLowerCase();
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const skew = 38;
  const damp = 700;
  const basic = input.lastIndexOf("-");
  const output = basic > 0 ? [...input.slice(0, basic)] : [];
  let n = 128;
  let bias = 72;
  let i = 0;
  const adapt = (deltaIn: number, numPoints: number, first: boolean) => {
    let delta = first ? Math.floor(deltaIn / damp) : deltaIn >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  const digit = (ch: string) => {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return code - 22; // 0-9 → 26-35
    if (code >= 97 && code <= 122) return code - 97; // a-z → 0-25
    return -1;
  };
  for (let pos = basic > 0 ? basic + 1 : 0; pos < input.length; ) {
    const oldI = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (pos >= input.length) return label;
      const d = digit(input[pos++]);
      if (d < 0) return label;
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldI, output.length + 1, oldI === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i, 0, String.fromCodePoint(n));
    i++;
  }
  return output.join("");
}

function decodeDomain(domain: string): string {
  return domain.split(".").map(decodePunycodeLabel).join(".");
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses a simple word overlap algorithm
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = foldDanish(normalizeText(str1), "double").split(" ");
  const words2 = foldDanish(normalizeText(str2), "double").split(" ");

  if (words1.length === 0 || words2.length === 0) return 0;

  let matches = 0;
  for (const word1 of words1) {
    for (const word2 of words2) {
      // Exact match
      if (word1 === word2 && word1.length > 2) {
        matches++;
      }
      // Substring match for longer words
      else if (word1.length > 4 && word2.length > 4) {
        if (word1.includes(word2) || word2.includes(word1)) {
          matches += 0.7;
        }
      }
    }
  }

  return matches / Math.max(words1.length, words2.length);
}

/**
 * Extract domain name without TLD and subdomain
 * Example: "app.acmecorp.com" -> "acmecorp"
 */
function extractDomainName(domain: string): string {
  const parts = decodeDomain(domain).split(".");

  // Remove common subdomains
  const commonSubdomains = [
    "www",
    "app",
    "portal",
    "admin",
    "dashboard",
    "dev",
    "staging",
    "test",
  ];
  let relevantParts = parts.filter(
    (part) => !commonSubdomains.includes(part.toLowerCase()),
  );

  // If we filtered everything, use original
  if (relevantParts.length === 0) {
    relevantParts = parts;
  }

  // Remove TLD (.com, .dk, .co.uk, etc.)
  if (relevantParts.length > 1) {
    relevantParts = relevantParts.slice(0, -1);
  }

  return relevantParts.join("");
}

/**
 * Find potential client/project matches based on domain and title
 */
export function findPotentialMatches(
  domain: string,
  url: string,
  title: string,
  clients: Client[],
  projects: Project[],
): MatchResult[] {
  const matches: MatchResult[] = [];
  const domainName = extractDomainName(domain);
  let decodedUrl = url;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    // Ugyldig %-kodning: brug URL'en som den er
  }
  const urlFolded = [
    foldDanish(decodedUrl.toLowerCase(), "double"),
    foldDanish(decodedUrl.toLowerCase(), "single"),
  ];
  const domainKeys = compactKeys(domainName);

  // 1. Match domain with client name. Sammenlignes som kompakte nøgler
  // ("bagerietpaahjoernet"), så kundenavne med flere ord og æøå også kan
  // matche et domæne.
  for (const client of clients) {
    const clientKeys = compactKeys(client.name);
    let similarity = 0;
    for (const d of domainKeys) {
      for (const c of clientKeys) {
        if (!d || !c || (!d.includes(c) && !c.includes(d))) continue;
        similarity = Math.max(
          similarity,
          Math.min(d.length, c.length) / Math.max(d.length, c.length),
        );
      }
    }
    if (similarity >= 0.5) {
      matches.push({
        type: "client",
        id: client.id,
        name: client.name,
        confidence: similarity,
        matchReason: t("site.match.domain", { name: client.name }),
      });

      // Also suggest projects for this client
      const clientProjects = projects.filter((p) => p.clientId === client.id);
      for (const project of clientProjects) {
        matches.push({
          type: "project",
          id: project.id,
          name: project.name,
          confidence: similarity * 0.9,
          matchReason: t("site.match.projectAt", { client: client.name }),
        });
      }
    }
  }

  // 2. Match page title with client/project names
  for (const client of clients) {
    const similarity = calculateSimilarity(title, client.name);
    if (similarity > 0.4 && !matches.some((m) => m.id === client.id)) {
      matches.push({
        type: "client",
        id: client.id,
        name: client.name,
        confidence: similarity * 0.8, // Lower confidence for title matches
        matchReason: t("site.match.titleClient", { name: client.name }),
      });
    }
  }

  for (const project of projects) {
    const similarity = calculateSimilarity(title, project.name);
    if (similarity > 0.4 && !matches.some((m) => m.id === project.id)) {
      const client = clients.find((c) => c.id === project.clientId);
      matches.push({
        type: "project",
        id: project.id,
        name: project.name,
        confidence: similarity * 0.8,
        matchReason: client
          ? t("site.match.titleProjectWithClient", {
              name: project.name,
              client: client.name,
            })
          : t("site.match.titleProject", { name: project.name }),
      });
    }
  }

  // 3. Match URL path/query with project names
  for (const project of projects) {
    const projectWords = normalizeText(project.name).split(" ");
    for (const word of projectWords) {
      const wordVariants = [
        foldDanish(word, "double"),
        foldDanish(word, "single"),
      ];
      const inUrl = wordVariants.some((w) =>
        urlFolded.some((u) => u.includes(w)),
      );
      if (word.length > 3 && inUrl) {
        if (!matches.some((m) => m.id === project.id)) {
          const client = clients.find((c) => c.id === project.clientId);
          matches.push({
            type: "project",
            id: project.id,
            name: project.name,
            confidence: 0.6,
            matchReason: client
              ? t("site.match.urlWithClient", {
                  word,
                  name: project.name,
                  client: client.name,
                })
              : t("site.match.url", { word, name: project.name }),
          });
        }
      }
    }
  }

  // Sort by confidence (highest first) and remove duplicates
  const uniqueMatches = Array.from(
    new Map(matches.map((m) => [`${m.type}-${m.id}`, m])).values(),
  );

  return uniqueMatches.sort((a, b) => b.confidence - a.confidence).slice(0, 5); // Return top 5 matches
}

/**
 * Get the best match from a list of potential matches
 */
export function getBestMatch(matches: MatchResult[]): MatchResult | null {
  if (matches.length === 0) return null;

  // Return match with highest confidence above threshold
  const bestMatch = matches[0];
  return bestMatch.confidence >= 0.5 ? bestMatch : null;
}

/**
 * Format confidence as percentage
 */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}
