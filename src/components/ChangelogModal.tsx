"use client";

import { Newspaper, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import sanitizeHtml from "sanitize-html";
import { useBrand } from "@/components/BrandContext";
import { BrandIcon } from "@/components/Logo";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

/**
 * Minimal markdown → HTML for changelog content.
 * Supports: headings, bold, italic, lists, images, links, paragraphs.
 */
function renderMarkdown(md: string): string {
  const html = md
    // Images: ![alt](url)
    .replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      '<img src="$2" alt="$1" class="rounded-lg my-3 max-w-full" loading="lazy" />',
    )
    // Links: [text](url)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-brand-600 hover:underline dark:text-brand-400">$1</a>',
    )
    // Headings
    .replace(
      /^### (.+)$/gm,
      '<h4 class="text-sm font-semibold text-gray-900 dark:text-white mt-3 mb-1">$1</h4>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h3 class="text-base font-semibold text-gray-900 dark:text-white mt-4 mb-1">$1</h3>',
    )
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // List items
    .replace(
      /^[-*] (.+)$/gm,
      '<li class="text-sm text-gray-600 dark:text-gray-300 ml-4">$1</li>',
    )
    // Wrap consecutive <li> in <ul>
    .replace(
      /(<li[^>]*>.*<\/li>\n?)+/g,
      (match) => `<ul class="list-disc space-y-0.5 my-1">${match}</ul>`,
    )
    // Paragraphs: lines that aren't already wrapped
    .replace(
      /^(?!<[hula]|<img|<strong|<em)(.+)$/gm,
      '<p class="text-sm text-gray-600 dark:text-gray-300 my-1">$1</p>',
    );

  return sanitizeHtml(html, {
    allowedTags: ["h3", "h4", "p", "ul", "li", "a", "img", "strong", "em"],
    allowedAttributes: {
      a: ["href", "target", "rel", "class"],
      img: ["src", "alt", "class", "loading"],
      "*": ["class"],
    },
  });
}

interface ChangelogModalProps {
  /** Force open from parent (e.g., user clicked "Nyheder" in menu) */
  forceOpen?: boolean;
  onClose?: () => void;
}

export function ChangelogModal({
  forceOpen,
  onClose,
}: ChangelogModalProps = {}) {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("shell.changelog");
  const intlLocale = toIntlLocale(useLocale());
  const { data: unseen } = trpc.changelog.getUnseen.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const [autoOpen, setAutoOpen] = useState(false);
  const open = forceOpen || autoOpen;
  // Hele changelog-historikken (inkl. markdown) hentes først når modalen
  // faktisk åbnes — ikke ved hver dashboard-indlæsning.
  const { data: all } = trpc.changelog.getAll.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    enabled: !!open,
  });
  const markSeen = trpc.changelog.markSeen.useMutation();
  const utils = trpc.useUtils();

  // Auto-open when unseen changelogs arrive
  useEffect(() => {
    if (unseen && unseen.length > 0 && !forceOpen) {
      setAutoOpen(true);
    }
  }, [unseen, forceOpen]);

  // When force-opened, expand the latest entry
  const handleClose = () => {
    setAutoOpen(false);
    onClose?.();
    if (unseen && unseen.length > 0) {
      markSeen.mutate(
        { changelogId: unseen[0].id },
        {
          onSuccess: () => {
            utils.changelog.getUnseen.invalidate();
          },
        },
      );
    }
  };

  // Close on Escape key
  useEscapeKey(handleClose, !!open);

  // Listen viser altid alle udgivelser med prik på de ulæste — også ved
  // auto-open. Før viste auto-open kun de ulæste, så listen skiftede indhold
  // alt efter hvordan man kom ind. Fald tilbage til de ulæste mens getAll
  // stadig henter, så auto-open ikke flimrer.
  const entries = all ?? unseen;
  const entriesLoading = !entries;

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Vælg nyeste ulæste hvis der er en, ellers nyeste udgivelse
  useEffect(() => {
    if (entries && entries.length > 0) {
      setSelectedId(unseen?.[0]?.id ?? entries[0].id);
    }
  }, [entries, unseen]);

  if (!open) {
    return null;
  }

  // Still loading
  if (entriesLoading) {
    if (!forceOpen) return null;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
      // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 dark:border-brand-400" />
        </div>
      </div>
    );
  }

  // Loaded but no entries
  if (!entries || entries.length === 0) {
    if (!forceOpen) return null;
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
      // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-brand-50 dark:bg-tt-gran-lys">
            <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
              <BrandIcon size={24} brand={brand} />
              {t("title", { brand: brand.name })}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t("closeLabel")}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-6 py-12 text-center">
            <Newspaper className="h-10 w-10 text-gray-400 dark:text-gray-500 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("empty")}
            </p>
          </div>
          <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran hover:bg-tt-gran-moerk rounded-lg transition-colors"
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? entries[0];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    // biome-ignore lint/a11y/useKeyWithClickEvents: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      data-testid="changelog-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 bg-brand-50 dark:bg-tt-gran-lys">
          <div className="flex items-center gap-3">
            <BrandIcon size={28} brand={brand} />
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {t("title", { brand: brand.name })}
              </h2>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("closeLabel")}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Split layout — sidebar hidden on mobile, stacked fallback */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar — entry list (hidden on small screens) */}
          <div className="hidden sm:block w-56 shrink-0 border-r border-gray-100 dark:border-gray-700 overflow-y-auto bg-gray-50/50 dark:bg-gray-900/30">
            {entries.map((entry) => {
              const isSelected = entry.id === selectedEntry.id;
              const isUnseen = unseen?.some((u) => u.id === entry.id);

              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-gray-700/50 transition-colors ${
                    isSelected
                      ? "bg-white dark:bg-gray-800 border-l-2 border-l-brand-500"
                      : "hover:bg-white dark:hover:bg-gray-800 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {isUnseen && (
                      <span className="h-2 w-2 rounded-full bg-brand-500 shrink-0" />
                    )}
                    <p
                      className={`text-sm truncate ${
                        isSelected
                          ? "font-semibold text-gray-900 dark:text-white"
                          : "font-medium text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {entry.title}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 pl-4">
                    {new Date(entry.publishedAt).toLocaleDateString(
                      intlLocale,
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      },
                    )}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto">
            {/* Mobile entry picker (shown only on small screens) */}
            <div className="sm:hidden px-4 pt-4">
              <select
                value={selectedEntry.id}
                onChange={(e) => setSelectedId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
              >
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="px-6 py-5">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                {selectedEntry.title}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                {new Date(selectedEntry.publishedAt).toLocaleDateString(
                  intlLocale,
                  {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  },
                )}
              </p>
              <div
                className="typeset typeset-app"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized markdown
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(selectedEntry.content),
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={handleClose}
            data-testid="changelog-close"
            className="px-6 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran hover:bg-tt-gran-moerk rounded-lg transition-colors"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
