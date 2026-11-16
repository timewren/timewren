/**
 * Kategorisering af det aktive websted til site-forslaget i popup'en. Ren
 * funktion af domæne og titel, så den kører i popup'en ud fra tabs-API'et
 * (activeTab) i stedet for et content script på alle sider.
 */

import type { CurrentSite } from "../stores/siteStore";

export type SiteCategory =
  | "development"
  | "design"
  | "communication"
  | "project-management"
  | "documentation"
  | "social-media"
  | "entertainment"
  | "productivity"
  | "other";

// Common work-related domains and patterns
const WORK_DOMAINS: Record<string, SiteCategory> = {
  // Development
  "github.com": "development",
  "gitlab.com": "development",
  "bitbucket.org": "development",
  "stackoverflow.com": "development",
  "vercel.app": "development",
  "netlify.app": "development",
  "railway.app": "development",
  "render.com": "development",
  "heroku.com": "development",
  "aws.amazon.com": "development",
  "cloud.google.com": "development",
  "azure.microsoft.com": "development",
  "npmjs.com": "development", // Canonical npm registry domain
  "pypi.org": "development",
  "packagist.org": "development",
  "crates.io": "development",
  "go.dev": "development",
  localhost: "development",
  "127.0.0.1": "development",

  // Design
  "figma.com": "design",
  "sketch.com": "design",
  "adobe.com": "design",
  "canva.com": "design",
  "dribbble.com": "design",
  "behance.net": "design",
  "invisionapp.com": "design",

  // Communication
  "slack.com": "communication",
  "discord.com": "communication",
  "teams.microsoft.com": "communication",
  "zoom.us": "communication",
  "meet.google.com": "communication",
  "whereby.com": "communication",
  "mail.google.com": "communication",
  "outlook.office.com": "communication",

  // Project Management
  "trello.com": "project-management",
  "asana.com": "project-management",
  "monday.com": "project-management",
  "linear.app": "project-management",
  "jira.atlassian.com": "project-management",
  "basecamp.com": "project-management",
  "clickup.com": "project-management",

  // Documentation
  "docs.google.com": "documentation",
  "drive.google.com": "documentation",
  "dropbox.com": "documentation",
  "evernote.com": "documentation",
  "confluence.atlassian.com": "documentation",

  // Social Media (usually not work-related)
  "facebook.com": "social-media",
  "instagram.com": "social-media",
  "twitter.com": "social-media",
  "x.com": "social-media",
  "linkedin.com": "communication", // LinkedIn can be work-related
  "tiktok.com": "social-media",
  "reddit.com": "social-media",

  // Entertainment
  "youtube.com": "entertainment",
  "netflix.com": "entertainment",
  "twitch.tv": "entertainment",
  "spotify.com": "entertainment",

  // Productivity
  "timetrack.dk": "productivity",
  "notion.so": "productivity",
  "todoist.com": "productivity",
  "any.do": "productivity",
};

// Platform domains that should only match exactly, not as subdomains
// (e.g., "vercel.app" itself is dev, but "myapp.vercel.app" is not)
const EXACT_MATCH_ONLY_DOMAINS = new Set([
  "vercel.app",
  "netlify.app",
  "railway.app",
  "render.com",
]);

// Domains that should NEVER be categorized as work-related, regardless
// of page title keywords. Prevents false positives like YouTube videos
// titled "Building a Project Dashboard" triggering work suggestions.
const ENTERTAINMENT_BLOCKLIST = new Set([
  "youtube.com",
  "netflix.com",
  "reddit.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "twitch.tv",
  "discord.com",
  "9gag.com",
  "imgur.com",
  "pinterest.com",
  "spotify.com",
]);

// Helper to determine if a category is work-related
function isWorkRelatedCategory(category: SiteCategory): boolean {
  return category !== "social-media" && category !== "entertainment";
}

export function categorizeSite(
  domain: string,
  title: string,
): {
  category: SiteCategory;
  isWorkRelated: boolean;
  confidence: number;
} {
  // Block entertainment sites before any keyword matching
  const baseDomain = domain.split(".").slice(-2).join(".");
  if (
    ENTERTAINMENT_BLOCKLIST.has(baseDomain) ||
    ENTERTAINMENT_BLOCKLIST.has(domain)
  ) {
    return {
      category: "entertainment",
      isWorkRelated: false,
      confidence: 0.95,
    };
  }

  // Check exact domain match
  const exactMatch = WORK_DOMAINS[domain];
  if (exactMatch) {
    return {
      category: exactMatch,
      isWorkRelated: isWorkRelatedCategory(exactMatch),
      confidence: 0.95,
    };
  }

  // Check subdomain patterns (skip platform domains that should only match exactly)
  for (const [workDomain, category] of Object.entries(WORK_DOMAINS)) {
    if (
      !EXACT_MATCH_ONLY_DOMAINS.has(workDomain) &&
      domain.endsWith(`.${workDomain}`)
    ) {
      return {
        category,
        isWorkRelated: isWorkRelatedCategory(category),
        confidence: 0.9,
      };
    }
  }

  // Analyze URL patterns for development
  if (
    domain.match(/^\d{1,3}(\.\d{1,3}){3}$/) ||
    domain.startsWith("dev.") ||
    domain.startsWith("staging.") ||
    domain.startsWith("test.")
  ) {
    return {
      category: "development",
      isWorkRelated: true,
      confidence: 0.85,
    };
  }

  // Analyze title for work-related keywords
  const workKeywords = [
    "dashboard",
    "admin",
    "portal",
    "workspace",
    "project",
    "task",
    "client",
    "invoice",
    "crm",
    "documentation",
    "docs",
    "api",
  ];

  // Use word-boundary regex to avoid false positives (e.g., "projector" shouldn't match "project")
  const escapedKeywords = workKeywords.map((keyword) =>
    keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const keywordPattern = new RegExp(
    `\\b(${escapedKeywords.join("|")})\\b`,
    "i",
  );
  const hasWorkKeywords = keywordPattern.test(title);

  if (hasWorkKeywords) {
    return {
      category: "productivity",
      isWorkRelated: true,
      confidence: 0.7,
    };
  }

  // Default: unknown
  return {
    category: "other",
    isWorkRelated: false,
    confidence: 0.5,
  };
}

/** Den aktive fane → det popup'en viser forslag ud fra (kun http/https). */
export function siteFromTab(tab: {
  url?: string;
  title?: string;
  favIconUrl?: string;
}): CurrentSite | null {
  if (!tab.url?.startsWith("http")) return null;
  let domain: string;
  try {
    domain = new URL(tab.url).hostname;
  } catch {
    return null;
  }
  const title = tab.title || "";
  return {
    url: tab.url,
    domain,
    title,
    favicon: tab.favIconUrl || null,
    ...categorizeSite(domain, title),
  };
}
