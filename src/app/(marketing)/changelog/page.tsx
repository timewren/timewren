import {
  AlertTriangle,
  Bug,
  CalendarDays,
  ExternalLink,
  MessageCircle,
  Sparkles,
  Tag,
  Wrench,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import sanitizeHtml from "sanitize-html";
import { Footer } from "@/components/Footer";
import { MarketingHero } from "@/components/marketing/MarketingHero";
import { Navigation } from "@/components/Navigation";
import { getChangelogRepo } from "@/lib/release-repos";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Se de seneste opdateringer, nye funktioner og forbedringer til TimeTrack. Jeg udvikler løbende nye funktioner til freelancere.",
  openGraph: {
    title: "Changelog",
    description:
      "Se de seneste opdateringer, nye funktioner og forbedringer til TimeTrack. Jeg udvikler løbende nye funktioner til freelancere.",
  },
};

// Revalidate every hour
export const revalidate = 3600;

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

interface ParsedRelease {
  id: number;
  version: string;
  title: string;
  body: string;
  publishedAt: Date;
  url: string;
  isPrerelease: boolean;
  versionType: "major" | "minor" | "patch";
  tags: string[];
}

function parseVersion(tagName: string): "major" | "minor" | "patch" {
  const version = tagName.replace(/^v/, "");
  const parts = version.split(".");

  if (parts.length < 3) return "patch";

  const [, minor, patch] = parts;
  if (patch === "0" && minor === "0") return "major";
  if (patch === "0") return "minor";
  return "patch";
}

function extractTags(body: string): string[] {
  const tags: string[] = [];
  const bodyLower = body.toLowerCase();

  if (bodyLower.includes("breaking") || bodyLower.includes("⚠️")) {
    tags.push("Breaking Change");
  }
  if (
    bodyLower.includes("### new") ||
    bodyLower.includes("### features") ||
    bodyLower.includes("✨")
  ) {
    tags.push("New");
  }
  if (
    bodyLower.includes("### fix") ||
    bodyLower.includes("### bug") ||
    bodyLower.includes("🐛")
  ) {
    tags.push("Fix");
  }
  if (
    bodyLower.includes("### improvement") ||
    bodyLower.includes("### enhance") ||
    bodyLower.includes("🔧")
  ) {
    tags.push("Improvement");
  }
  // Markér release-noter, der nævner et kundeønske, så changelog kan vise
  // "bygget efter ønske fra en kunde" (kunde B, 23/10-26, issue #870). Skriv
  // "Kundeønske" i release-notens body for at sætte mærket.
  if (bodyLower.includes("kundeønske") || bodyLower.includes("💬")) {
    tags.push("Kundeønske");
  }

  return tags.length > 0 ? tags : ["Update"];
}

async function getGitHubReleases(): Promise<ParsedRelease[]> {
  const repo = getChangelogRepo();
  if (!repo) return [];
  try {
    const headers: HeadersInit = {
      Accept: "application/vnd.github.v3+json",
    };

    // Add auth for private repos
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases`,
      {
        headers,
        next: { revalidate: 3600 }, // Cache for 1 hour
      },
    );

    if (!response.ok) {
      console.error("GitHub API error:", response.status, response.statusText);
      return [];
    }

    const releases: GitHubRelease[] = await response.json();

    return releases
      .filter((r) => !r.draft)
      .map((release) => ({
        id: release.id,
        version: release.tag_name,
        title: release.name || release.tag_name,
        body: release.body || "",
        publishedAt: new Date(release.published_at),
        url: release.html_url,
        isPrerelease: release.prerelease,
        versionType: parseVersion(release.tag_name),
        tags: extractTags(release.body || ""),
      }));
  } catch (error) {
    console.error("Failed to fetch GitHub releases:", error);
    return [];
  }
}

function TagBadge({ tag }: { tag: string }) {
  const config: Record<string, { icon: React.ElementType; className: string }> =
    {
      New: {
        icon: Sparkles,
        className:
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      },
      Fix: {
        icon: Bug,
        className:
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
      },
      Improvement: {
        icon: Wrench,
        className:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      },
      "Breaking Change": {
        icon: AlertTriangle,
        className:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
      },
      Update: {
        icon: Tag,
        className:
          "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400",
      },
      Kundeønske: {
        icon: MessageCircle,
        className:
          "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      },
    };

  const { icon: Icon, className } = config[tag] || config.Update;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}
    >
      <Icon className="w-3 h-3" />
      {tag}
    </span>
  );
}

function VersionBadge({ type }: { type: "major" | "minor" | "patch" }) {
  const config = {
    major:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    minor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    patch: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };

  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${config[type]}`}
    >
      {type}
    </span>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("da-DK", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

// Simple markdown-to-HTML converter for release notes
function renderMarkdown(text: string): string {
  const rawHtml = text
    // Headers
    .replace(
      /^### (.+)$/gm,
      '<h4 class="text-lg font-semibold text-slate-900 dark:text-white mt-4 mb-2">$1</h4>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h3 class="text-xl font-semibold text-slate-900 dark:text-white mt-6 mb-3">$1</h3>',
    )
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Code
    .replace(
      /`([^`]+)`/g,
      '<code class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-sm font-mono">$1</code>',
    )
    // Links
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-brand-600 dark:text-brand-400 hover:underline" target="_blank" rel="noopener">$1</a>',
    )
    // Lists
    .replace(
      /^- (.+)$/gm,
      '<li class="ml-4 list-disc text-slate-600 dark:text-slate-400">$1</li>',
    )
    .replace(
      /^(\d+)\. (.+)$/gm,
      '<li class="ml-4 list-decimal text-slate-600 dark:text-slate-400">$2</li>',
    )
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p class="text-slate-600 dark:text-slate-400 mt-2">')
    // Single newlines in lists
    .replace(/\n(?=<li)/g, "")
    // Wrap in paragraph
    .replace(
      /^([\s\S]+)$/,
      '<p class="text-slate-600 dark:text-slate-400">$1</p>',
    );

  return sanitizeHtml(rawHtml, {
    allowedTags: [
      "h3",
      "h4",
      "p",
      "strong",
      "em",
      "code",
      "a",
      "li",
      "ul",
      "ol",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel", "class"],
      "*": ["class"],
    },
    allowedSchemes: ["https", "http"],
  });
}

function ReleaseCard({ release }: { release: ParsedRelease }) {
  return (
    <article className="relative border-l-2 border-slate-200/60 dark:border-slate-700 pl-6 pb-10 last:pb-0">
      {/* Timeline dot */}
      <div className="absolute -left-2 top-0 w-4 h-4 rounded-full bg-brand-600 dark:bg-brand-400 border-2 border-white dark:border-gray-900" />

      <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                {release.version}
              </h3>
              <VersionBadge type={release.versionType} />
              {release.isPrerelease && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Pre-release
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <CalendarDays className="w-4 h-4" />
              {formatDate(release.publishedAt)}
            </div>
          </div>

          <a
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            GitHub
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-4">
          {release.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>

        {/* Content */}
        {release.body && (
          <div
            className="typeset typeset-doc"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown kører sanitizeHtml med tag- og attribut-whitelist
            dangerouslySetInnerHTML={{ __html: renderMarkdown(release.body) }}
          />
        )}
      </div>
    </article>
  );
}

export default async function ChangelogPage() {
  const releases = await getGitHubReleases();

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950">
      <Navigation />

      <MarketingHero
        title="Changelog"
        subtitle="Hold dig opdateret med de seneste forbedringer, nye features og fejlrettelser i TimeTrack."
      />

      {/* Releases */}
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          {releases.length === 0 ? (
            <div className="text-center py-12">
              <Tag className="w-12 h-12 mx-auto mb-4 text-slate-400" />
              <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">
                Ingen releases endnu
              </h3>
              <p className="text-slate-500 dark:text-slate-400">
                Kom tilbage snart for at se de seneste opdateringer.
              </p>
            </div>
          ) : (
            <div className="relative">
              {releases.map((release) => (
                <ReleaseCard key={release.id} release={release} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t bg-slate-50 dark:bg-slate-900 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
            Se hvad der kommer
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            Tjek min roadmap for at se planlagte features og hvad jeg arbejder
            på lige nu.
          </p>
          <Link
            href="/roadmap"
            className="inline-flex items-center gap-2 rounded-2xl bg-tt-gran px-6 py-3 font-semibold text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
          >
            Se Roadmap
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
