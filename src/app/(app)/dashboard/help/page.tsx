"use client";

import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileText,
  FolderKanban,
  Globe,
  HelpCircle,
  Image as ImageIcon,
  Keyboard,
  LayoutDashboard,
  Play,
  Plug,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";
import NextImage from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { supportEmailOf, useBrand } from "@/components/BrandContext";
import { goToShortcuts, PageHeader } from "@/components/dashboard-nav";
import { brand as buildBrand } from "@/lib/brand";
import { trpc } from "@/providers/trpc-provider";

// --- Data ---

interface HelpItem {
  /** Dansk spørgsmål: stabilt id til feedback (gemmes pr. spørgsmål). */
  question: string;
  /** Placering i emnet; nøgle i help.topics.<id>.items.<idx>. */
  idx?: number;
  screenshot?: string; // path relative to /help/screenshots/
  video?: string; // path relative to /help/videos/ (mp4 preferred, webm fallback)
}

interface HelpTopic {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  screenshot?: string; // topic-level hero screenshot
  items: HelpItem[];
}

const helpTopics: HelpTopic[] = [
  {
    id: "getting-started",
    icon: BookOpen,
    items: [
      {
        question: "Hvordan tilføjer jeg min første kunde?",
      },
      {
        question: "Hvad er forskellen på projekter og kunder?",
      },
      {
        question: "Hvordan registrerer jeg tid?",
      },
      {
        question: "Hvordan gennemgår jeg rundvisningen igen?",
      },
      {
        question: "Findes der tastaturgenveje?",
      },
    ],
  },
  {
    id: "clients",
    icon: Users,
    screenshot: "clients-list.png",
    items: [
      {
        question: "Hvordan opsætter jeg en specifik timepris for en kunde?",
      },
      {
        question: "Kan jeg slette en kunde?",
      },
      {
        question: "Hvad er prisniveauet?",
      },
    ],
  },
  {
    id: "projects",
    icon: FolderKanban,
    screenshot: "projects-list.png",
    items: [
      {
        question: "Hvad er forskellen på time-baseret og fast pris?",
      },
      {
        question: "Hvordan holder jeg styr på projektfrister?",
      },
      {
        question: "Kan jeg flytte et projekt til en anden kunde?",
      },
    ],
  },
  {
    id: "time-tracking",
    icon: Clock,
    screenshot: "time-tracking.png",
    items: [
      {
        question: "Hvordan virker timeren?",
        video: "timer-start-stop.mp4",
      },
      {
        question: "Kan jeg redigere tidligere tidsposteringer?",
      },
      {
        question: "Hvordan bruger jeg flere tidsposteringer samtidig?",
      },
      {
        question: "Hvad er ugeoversigten (timesheet)?",
      },
      {
        question: "Kan jeg importere tid fra CSV?",
      },
    ],
  },
  {
    id: "tasks",
    icon: CheckCircle2,
    screenshot: "tasks-kanban.png",
    items: [
      {
        question: "Hvad er forskellen på kanban-board og listevisning?",
      },
      {
        question: "Hvordan opretter jeg en opgave?",
      },
      {
        question: "Hvordan flytter jeg opgaver mellem kolonner?",
      },
      {
        question: "Kan jeg starte en timer direkte fra en opgave?",
      },
      {
        question: "Kan jeg lave mine egne kolonner?",
      },
    ],
  },
  {
    id: "dashboard",
    icon: LayoutDashboard,
    screenshot: "dashboard-overview.png",
    items: [
      {
        question: "Hvad viser dashboardet?",
        video: "dashboard-widgets.mp4",
      },
      {
        question: "Kan jeg tilpasse dashboardet?",
      },
      {
        question: "Hvilke widgets er tilgængelige?",
      },
    ],
  },
  {
    id: "klippekort",
    icon: Ticket,
    screenshot: "klippekort-overview.png",
    items: [
      {
        question: "Hvad er et klippekort?",
      },
      {
        question: "Hvordan opretter jeg et klippekort?",
      },
      {
        question: "Hvad sker der når et klippekort løber tør?",
      },
      {
        question: "Kan jeg se historik for et klippekort?",
      },
    ],
  },
  {
    id: "templates",
    icon: RefreshCw,
    screenshot: "templates-list.png",
    items: [
      {
        question: "Hvad er tilbagevendende skabeloner?",
      },
      {
        question: "Hvordan opretter jeg en skabelon?",
      },
      {
        question: "Kan jeg redigere eller slette genererede tidsposteringer?",
      },
    ],
  },
  {
    id: "invoices",
    icon: FileText,
    screenshot: "invoices-list.png",
    items: [
      {
        question: "Hvordan opretter jeg en faktura?",
      },
      {
        question: "Hvad er forskellen på 'Kladde', 'Sendt' og 'Betalt'?",
      },
      {
        question: "Kan jeg eksportere fakturaer til PDF?",
      },
      {
        question: "Kan jeg generere faktura fra tidsregistreringer?",
      },
      {
        question: "Hvad viser fakturaoverblikket?",
      },
    ],
  },
  {
    id: "reports",
    icon: TrendingUp,
    screenshot: "reports-view.png",
    items: [
      {
        question: "Hvilke rapporter kan jeg generere?",
      },
      {
        question: "Hvordan eksporterer jeg data til Excel?",
      },
    ],
  },
  {
    id: "keyboard-shortcuts",
    icon: Keyboard,
    items: [
      {
        question: "Hvilke navigationsgenveje findes der?",
      },
      {
        question: "Hvilke timer-genveje findes der?",
      },
      {
        question: "Hvad er Command Palette?",
        video: "command-palette.mp4",
      },
      {
        question: "Hvordan ser jeg alle genveje?",
        video: "keyboard-navigation.mp4",
      },
      {
        question: "Kan jeg genstarte rundvisningen?",
      },
    ],
  },
  {
    id: "browser-extension",
    icon: Globe,
    items: [
      {
        // Kun nøgle (makeQuestionKey); den viste tekst kommer fra kataloget.
        question: `Hvad er ${buildBrand.name} browser extension?`,
      },
      {
        question: "Hvordan opsætter jeg URL-mønstre?",
      },
      {
        question: "Hvordan installerer jeg browser extension?",
      },
    ],
  },
  {
    id: "integrations",
    icon: Plug,
    screenshot: "integrations-page.png",
    items: [
      {
        question: "Hvordan bruger jeg CVR-opslag?",
      },
      {
        question: "Hvordan eksporterer jeg til Billy, Dinero eller e-conomic?",
      },
      {
        question: "Kan jeg synkronisere med Google Calendar?",
      },
    ],
  },
  {
    id: "security",
    icon: Shield,
    screenshot: "security-settings.png",
    items: [
      {
        question: "Hvad er passkeys?",
      },
      {
        question: "Hvordan aktiverer jeg to-faktor-godkendelse (2FA)?",
      },
      {
        question: "Hvordan administrerer jeg aktive sessioner?",
      },
    ],
  },
  {
    id: "import-export",
    icon: Download,
    items: [
      {
        question: "Hvordan importerer jeg tidsregistreringer fra CSV?",
      },
      {
        question: "Hvordan eksporterer jeg mine data?",
      },
      {
        question: "Kan jeg downloade alle mine data (GDPR)?",
      },
    ],
  },
  {
    id: "settings",
    icon: Settings,
    screenshot: "settings-page.png",
    items: [
      {
        question: "Hvordan ændrer jeg min standard timepris?",
      },
      {
        question: "Bliver alle mine ændringer logget?",
      },
      {
        question: "Hvordan sletter jeg min konto?",
      },
      {
        question: "Hvordan skifter jeg til mørkt tema?",
      },
      {
        question: "Hvad er virksomhedsprofilen?",
      },
    ],
  },
];

// Hvert spørgsmål kender sin placering, så teksten kan slås op i kataloget
for (const topic of helpTopics) {
  topic.items.forEach((item, idx) => {
    item.idx = idx;
  });
}

// Curated popular questions shown at top
const popularQuestions = [
  { topicId: "time-tracking", question: "Hvordan virker timeren?" },
  { topicId: "klippekort", question: "Hvad er et klippekort?" },
  { topicId: "keyboard-shortcuts", question: "Hvad er Command Palette?" },
  {
    topicId: "invoices",
    question: "Kan jeg generere faktura fra tidsregistreringer?",
  },
  {
    topicId: "getting-started",
    question: "Hvordan gennemgår jeg rundvisningen igen?",
  },
];

// --- Helpers ---

function makeQuestionKey(topicId: string, question: string) {
  return `${topicId}::${question}`;
}

function HighlightText({
  text,
  query,
}: {
  text: string;
  query: string;
}): ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark
        // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
        key={`${i}-${part}`}
        className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700 dark:text-yellow-100"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

type FeedbackValue = "up" | "down" | null;

// --- Component ---

export default function HelpPage() {
  return (
    <Suspense>
      <HelpPageContent />
    </Suspense>
  );
}

function HelpPageContent() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("help");
  const tNav = useTranslations("nav");
  const shortcuts = goToShortcuts
    .map(
      (s) =>
        `G+${s.key.toUpperCase()} = ${s.labelKey ? tNav(s.labelKey) : s.label}`,
    )
    .join(", ");
  const topicTitle = (topicId: string) => t(`topics.${topicId}.title`);
  const questionText = (topicId: string, item: HelpItem) =>
    t(`topics.${topicId}.items.${item.idx}.question`, { brand: brand.name });
  const answerText = (topicId: string, item: HelpItem) =>
    t(`topics.${topicId}.items.${item.idx}.answer`, {
      brand: brand.name,
      shortcuts,
    });
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialTopic = searchParams.get("topic") || "getting-started";
  const initialQuery = searchParams.get("q") || "";

  const [activeTopicId, setActiveTopicId] = useState(initialTopic);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // tRPC feedback — server-side persistence
  const { data: serverFeedback } = trpc.helpFeedback.myFeedback.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  const feedbackMutation = trpc.helpFeedback.submit.useMutation();
  const utils = trpc.useUtils();

  const feedback: Record<string, FeedbackValue> = (serverFeedback ??
    {}) as Record<string, FeedbackValue>;

  // Sync URL params when topic or search changes
  const updateUrl = useCallback(
    (topicId: string, query: string) => {
      const params = new URLSearchParams();
      if (topicId !== "getting-started") params.set("topic", topicId);
      if (query) params.set("q", query);
      const qs = params.toString();
      router.replace(`/dashboard/help${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    },
    [router],
  );

  const handleTopicChange = useCallback(
    (topicId: string) => {
      setActiveTopicId(topicId);
      setExpandedItems(new Set());
      updateUrl(topicId, searchQuery);
    },
    [searchQuery, updateUrl],
  );

  const handleSearchChange = useCallback(
    (query: string) => {
      setSearchQuery(query);
      updateUrl(activeTopicId, query);
      if (query.trim()) {
        const allKeys = new Set<string>();
        for (const topic of helpTopics) {
          for (const item of topic.items) {
            allKeys.add(makeQuestionKey(topic.id, item.question));
          }
        }
        setExpandedItems(allKeys);
      } else {
        setExpandedItems(new Set());
      }
    },
    [activeTopicId, updateUrl],
  );

  const toggleItem = useCallback((key: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleFeedback = useCallback(
    (key: string, value: "up" | "down") => {
      // Optimistic update
      utils.helpFeedback.myFeedback.setData(undefined, (old) => {
        const prev = old ?? {};
        const next = { ...prev };
        if (next[key] === value) {
          delete next[key];
        } else {
          next[key] = value;
        }
        return next;
      });
      feedbackMutation.mutate({ questionKey: key, value });
    },
    [feedbackMutation, utils],
  );

  const navigateToQuestion = useCallback(
    (topicId: string, question: string) => {
      setActiveTopicId(topicId);
      setSearchQuery("");
      const key = makeQuestionKey(topicId, question);
      setExpandedItems(new Set([key]));
      updateUrl(topicId, "");
    },
    [updateUrl],
  );

  const isSearching = searchQuery.trim().length > 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: tekstopslagene (questionText, answerText, topicTitle) følger t og tNav
  const filteredTopics = useMemo(
    () =>
      isSearching
        ? helpTopics
            .map((topic) => ({
              ...topic,
              items: topic.items.filter(
                (item) =>
                  questionText(topic.id, item)
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()) ||
                  answerText(topic.id, item)
                    .toLowerCase()
                    .includes(searchQuery.toLowerCase()),
              ),
            }))
            .filter((topic) => topic.items.length > 0)
        : helpTopics,
    [isSearching, searchQuery, t, tNav],
  );

  const activeTopic = isSearching
    ? null
    : helpTopics.find((t) => t.id === activeTopicId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tekstopslagene (questionText, answerText, topicTitle) følger t og tNav
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return filteredTopics.flatMap((topic) =>
      topic.items.map((item) => ({
        ...item,
        topicId: topic.id,
        topicTitle: topicTitle(topic.id),
        topicIcon: topic.icon,
      })),
    );
  }, [isSearching, filteredTopics, t]);

  const totalSearchResults = searchResults.length;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description", { brand: brand.name })}
      />

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-12 pr-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:placeholder-gray-500"
        />
        {isSearching && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500 dark:text-gray-400">
            {t("resultCount", { count: totalSearchResults })}
          </span>
        )}
      </div>

      {/* Popular questions */}
      {!isSearching && activeTopicId === "getting-started" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {t("popular")}
            </h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {popularQuestions.map((pq) => {
              const topic = helpTopics.find((t) => t.id === pq.topicId);
              if (!topic) return null;
              const Icon = topic.icon;
              return (
                <button
                  key={pq.question}
                  type="button"
                  onClick={() => navigateToQuestion(pq.topicId, pq.question)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50"
                >
                  <Icon className="h-3 w-3" />
                  {questionText(topic.id, {
                    question: pq.question,
                    idx: topic.items.find((i) => i.question === pq.question)
                      ?.idx,
                  })}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Sidebar */}
        <div className="lg:col-span-3">
          <div className="lg:sticky lg:top-20">
            <div className="rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
              <div className="border-b border-gray-200 p-4 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">
                  {t("topicsHeading")}
                </h2>
              </div>
              <nav className="max-h-[calc(100vh-12rem)] overflow-y-auto p-2">
                {(isSearching ? filteredTopics : helpTopics).map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    onClick={() => handleTopicChange(topic.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                      !isSearching && activeTopicId === topic.id
                        ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    <topic.icon className="h-5 w-5 shrink-0" />
                    <span className="truncate">{topicTitle(topic.id)}</span>
                    <span
                      className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        !isSearching && activeTopicId === topic.id
                          ? "bg-brand-200 text-brand-800 dark:bg-tt-gran-lys dark:text-brand-200"
                          : "bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {topic.items.length}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-9">
          <div className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
            {isSearching ? (
              <>
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {t("searchResultsFor", { query: searchQuery })}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t("foundIn", {
                      results: totalSearchResults,
                      topics: filteredTopics.length,
                    })}
                  </p>
                </div>
                {searchResults.length > 0 ? (
                  <div className="space-y-3">
                    {searchResults.map((item) => {
                      const key = makeQuestionKey(item.topicId, item.question);
                      const isExpanded = expandedItems.has(key);
                      const Icon = item.topicIcon;
                      return (
                        <div
                          key={key}
                          className="rounded-lg border border-gray-200 dark:border-gray-800"
                        >
                          <button
                            type="button"
                            onClick={() => toggleItem(key)}
                            className="flex w-full items-start gap-3 rounded-lg p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                          >
                            <span className="mt-0.5 shrink-0">
                              {isExpanded ? (
                                <ChevronDown className="h-5 w-5 text-brand-500 dark:text-brand-400" />
                              ) : (
                                <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold text-gray-900 dark:text-white">
                                <HighlightText
                                  text={questionText(item.topicId, item)}
                                  query={searchQuery}
                                />
                              </h3>
                              <div className="mt-1 flex items-center gap-1.5">
                                <Icon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {item.topicTitle}
                                </span>
                              </div>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-gray-200 px-4 pb-4 pt-3 dark:border-gray-700">
                              <p className="pl-8 leading-relaxed text-gray-600 dark:text-gray-400">
                                <HighlightText
                                  text={answerText(item.topicId, item)}
                                  query={searchQuery}
                                />
                              </p>
                              <ItemMedia
                                item={item}
                                label={questionText(item.topicId, item)}
                              />
                              <FeedbackButtons
                                questionKey={key}
                                feedback={feedback}
                                onFeedback={handleFeedback}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-12 text-center">
                    <HelpCircle className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                    <p className="mt-4 text-gray-600 dark:text-gray-400">
                      {t("noResults", { query: searchQuery })}
                    </p>
                  </div>
                )}
              </>
            ) : activeTopic ? (
              <>
                <div className="mb-6 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
                    <activeTopic.icon className="h-6 w-6 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                      {topicTitle(activeTopic.id)}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t("questionCount", { count: activeTopic.items.length })}
                    </p>
                  </div>
                </div>

                {/* Topic hero screenshot */}
                {activeTopic.screenshot && (
                  <TopicScreenshot
                    src={`/help/screenshots/${activeTopic.screenshot}`}
                    alt={t("screenshotAlt", {
                      title: topicTitle(activeTopic.id),
                    })}
                  />
                )}

                <div className="space-y-2">
                  {activeTopic.items.map((item) => {
                    const key = makeQuestionKey(activeTopic.id, item.question);
                    const isExpanded = expandedItems.has(key);
                    return (
                      <div
                        key={item.question}
                        className="rounded-lg border border-gray-200 dark:border-gray-800"
                      >
                        <button
                          type="button"
                          onClick={() => toggleItem(key)}
                          className="flex w-full items-center gap-3 rounded-lg p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 shrink-0 text-brand-500 dark:text-brand-400" />
                          ) : (
                            <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" />
                          )}
                          <h3 className="font-semibold text-gray-900 dark:text-white">
                            {questionText(activeTopic.id, item)}
                          </h3>
                          {item.video && (
                            <Play className="ml-auto h-4 w-4 shrink-0 text-brand-500 dark:text-brand-400" />
                          )}
                          {!item.video && item.screenshot && (
                            <ImageIcon className="ml-auto h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
                          )}
                        </button>
                        {isExpanded && (
                          <div className="border-t border-gray-200 px-4 pb-4 pt-3 dark:border-gray-700">
                            <p className="pl-8 leading-relaxed text-gray-600 dark:text-gray-400">
                              {answerText(activeTopic.id, item)}
                            </p>
                            <ItemMedia
                              item={item}
                              label={questionText(activeTopic.id, item)}
                            />
                            <FeedbackButtons
                              questionKey={key}
                              feedback={feedback}
                              onFeedback={handleFeedback}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="py-12 text-center">
                <HelpCircle className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500" />
                <p className="mt-4 text-gray-600 dark:text-gray-400">
                  {t("chooseTopic")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
        <h3 className="mb-4 font-semibold text-gray-900 dark:text-white">
          {t("cantFindTitle")}
        </h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t("cantFindBody")}
        </p>
        <a
          href={`mailto:${supportEmailOf(brand)}`}
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk"
        >
          {t("contactSupport")}
        </a>
      </div>
    </div>
  );
}

// --- Topic hero screenshot ---

function TopicScreenshot({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false);
  if (error) return null;
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-gray-200/80 dark:border-gray-800">
      <NextImage
        src={src}
        alt={alt}
        width={1280}
        height={800}
        className="w-full"
        onError={() => setError(true)}
        priority={false}
      />
    </div>
  );
}

// --- Item media (screenshot/video) ---

function ItemMedia({ item, label }: { item: HelpItem; label: string }) {
  const t = useTranslations("help");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoError, setVideoError] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (item.video && !videoError) {
    const basePath = `/help/videos/${item.video}`;
    const webmPath = basePath.replace(/\.mp4$/, ".webm");
    return (
      <div className="mt-3 pl-8">
        <video
          ref={videoRef}
          className="w-full max-w-lg rounded-lg border border-gray-200 dark:border-gray-800"
          autoPlay
          loop
          muted
          playsInline
          onError={() => setVideoError(true)}
        >
          <source src={basePath} type="video/mp4" />
          <source src={webmPath} type="video/webm" />
        </video>
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {t("videoDemo")}
        </p>
      </div>
    );
  }

  if (item.screenshot && !imgError) {
    return (
      <div className="mt-3 pl-8">
        <NextImage
          src={`/help/screenshots/${item.screenshot}`}
          alt={label}
          width={640}
          height={400}
          className="rounded-lg border border-gray-200 dark:border-gray-800"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return null;
}

// --- Feedback component ---

function FeedbackButtons({
  questionKey,
  feedback,
  onFeedback,
}: {
  questionKey: string;
  feedback: Record<string, FeedbackValue>;
  onFeedback: (key: string, value: "up" | "down") => void;
}) {
  const t = useTranslations("help");
  const current = feedback[questionKey] ?? null;
  return (
    <div className="mt-3 flex items-center gap-2 pl-8">
      <span className="text-xs text-gray-400 dark:text-gray-500">
        {t("wasHelpful")}
      </span>
      <button
        type="button"
        onClick={() => onFeedback(questionKey, "up")}
        className={`rounded p-1 transition-colors ${
          current === "up"
            ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        }`}
        title={t("yes")}
      >
        <ThumbsUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onFeedback(questionKey, "down")}
        className={`rounded p-1 transition-colors ${
          current === "down"
            ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
            : "text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        }`}
        title={t("no")}
      >
        <ThumbsDown className="h-4 w-4" />
      </button>
    </div>
  );
}
