import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Globe, Link2, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useT } from "../../i18n";
import { suggestionMayRelabel } from "../../lib/stop-save";
import { useAuthStore } from "../../stores/authStore";
import { useSiteStore } from "../../stores/siteStore";
import { useTimerStore } from "../../stores/timerStore";
import {
  findPotentialMatches,
  formatConfidence,
  getBestMatch,
} from "../../utils/smartMatching";

interface SiteSuggestionProps {
  onSelectProject: (projectId: string, clientId: string) => void;
  currentProjectId: string | null;
}

const CATEGORY_MAP: Record<string, { icon: string }> = {
  development: { icon: "\uD83D\uDCBB" },
  design: { icon: "\uD83C\uDFA8" },
  communication: { icon: "\uD83D\uDCAC" },
  "project-management": { icon: "\uD83D\uDCCB" },
  documentation: { icon: "\uD83D\uDCC4" },
  productivity: { icon: "\u26A1" },
  "social-media": { icon: "\uD83D\uDCF1" },
  entertainment: { icon: "\uD83C\uDFAE" },
  other: { icon: "\uD83C\uDF10" },
};

export function SiteSuggestion({
  onSelectProject,
  currentProjectId,
}: SiteSuggestionProps) {
  const { t } = useT();
  const { currentSite, suggestedProjectId, isDismissed, dismissSuggestion } =
    useSiteStore();
  const startTimer = useTimerStore((s) => s.startTimer);
  const stopAndStart = useTimerStore((s) => s.stopAndStart);
  const timer = useTimerStore((s) => s.timer);
  const hasTime = useTimerStore((s) => s.displayTime > 0);
  const withinRelabelGrace = useTimerStore((s) =>
    suggestionMayRelabel(s.displayTime),
  );
  const isSyncing = useTimerStore((s) => s.isSyncing);
  const addMapping = useSiteStore((s) => s.addMapping);
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [smartMatch, setSmartMatch] = useState<{
    projectId: string;
    clientId: string;
    reason: string;
    confidence: number;
  } | null>(null);

  const { data: projectsData } = useQuery({
    queryKey: ["projectsAndClients", selectedOrgId],
    queryFn: apiClient.getProjectsAndClients,
    staleTime: 1000 * 60 * 5,
    enabled: orgsLoaded,
  });

  // Find smart matches based on customer/project names
  useEffect(() => {
    if (!currentSite || !projectsData) {
      setSmartMatch(null);
      return;
    }

    const matches = findPotentialMatches(
      currentSite.domain,
      currentSite.url,
      currentSite.title,
      projectsData.clients,
      projectsData.projects,
    );

    const bestMatch = getBestMatch(matches);

    if (bestMatch && bestMatch.type === "project") {
      const project = projectsData.projects.find((p) => p.id === bestMatch.id);
      if (project) {
        setSmartMatch({
          projectId: project.id,
          clientId: project.clientId,
          reason: bestMatch.matchReason,
          confidence: bestMatch.confidence,
        });
      }
    } else if (bestMatch && bestMatch.type === "client") {
      // If we matched a client, suggest their most recently used project
      const clientProjects = projectsData.projects.filter(
        (p) => p.clientId === bestMatch.id,
      );
      if (clientProjects.length > 0) {
        setSmartMatch({
          projectId: clientProjects[0].id,
          clientId: clientProjects[0].clientId,
          reason: bestMatch.matchReason,
          confidence: bestMatch.confidence * 0.9,
        });
      }
    } else {
      setSmartMatch(null);
    }
  }, [currentSite, projectsData]);

  // Prioritize smart match over regular suggestion
  const projectIdToSuggest = smartMatch?.projectId || suggestedProjectId;
  const matchReason = smartMatch?.reason || null;
  const matchConfidence = smartMatch?.confidence || null;

  // Don't show if no suggestion, already selected, or user dismissed this domain
  if (
    !currentSite ||
    !projectIdToSuggest ||
    projectIdToSuggest === currentProjectId ||
    isDismissed(currentSite.domain)
  ) {
    return null;
  }

  const suggestedProject = projectsData?.projects.find(
    (p) => p.id === projectIdToSuggest,
  );

  if (!suggestedProject) {
    return null;
  }

  const isSmartMatch = !!smartMatch;

  const categoryKey =
    currentSite?.category && CATEGORY_MAP[currentSite.category]
      ? currentSite.category
      : "other";
  const confidencePercent = currentSite?.confidence
    ? Math.round(currentSite.confidence * 100)
    : 0;

  // Har timeren reel tid (kørende eller pauset over et minut), må forslaget
  // ALDRIG omdøbe den — så ville hele sessionen flytte til den foreslåede
  // kunde. I stedet: "stop & start", der gemmer den nuværende session via
  // det normale stop-flow og starter en ny på forslaget.
  const hasSession = !!timer?.isRunning || hasTime;
  const mayRelabel = !hasSession || withinRelabelGrace;

  const handleSelect = () => {
    if (!mayRelabel) return;
    onSelectProject(suggestedProject.id, suggestedProject.clientId);
  };

  const handlePlayStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasSession) {
      // Start direkte på forslaget. (Før blev projektet først skrevet på
      // timeren, og så sprang startTimer over, fordi skrivningen stadig var
      // i gang.)
      addMapping(
        currentSite.domain,
        suggestedProject.id,
        suggestedProject.clientId,
      );
      void startTimer(suggestedProject.id, suggestedProject.clientId, "");
      return;
    }
    if (mayRelabel) {
      // Lige startet (under et minut): ret blot kunden på den kørende timer
      onSelectProject(suggestedProject.id, suggestedProject.clientId);
      return;
    }
    addMapping(
      currentSite.domain,
      suggestedProject.id,
      suggestedProject.clientId,
    );
    const runningProject = projectsData?.projects.find(
      (p) => p.id === timer?.projectId,
    );
    const runningClient = projectsData?.clients.find(
      (c) => c.id === timer?.clientId,
    );
    void stopAndStart(
      {
        projectId: suggestedProject.id,
        clientId: suggestedProject.clientId,
      },
      {
        projectName: runningProject?.name ?? null,
        clientName: runningClient?.name ?? null,
      },
    );
  };

  return (
    <div className="mx-4 mb-2">
      <div className="w-full flex items-center gap-2.5 p-2.5 bg-primary-50 border border-primary-200 rounded-lg text-left">
        <button
          type="button"
          onClick={handleSelect}
          disabled={!mayRelabel}
          className="flex-1 flex items-center gap-2.5 min-w-0 hover:opacity-80 disabled:hover:opacity-100 disabled:cursor-default transition-opacity"
        >
          <div className="flex-shrink-0 w-9 h-9 bg-[var(--color-surface-base)] rounded-lg flex items-center justify-center">
            {currentSite?.favicon ? (
              <img
                src={currentSite.favicon}
                alt=""
                className="w-5 h-5"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <Globe size={18} className="text-primary-600" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {isSmartMatch ? (
                <>
                  <Link2 size={12} className="text-primary-600" />
                  <span className="text-xs font-semibold text-primary-700">
                    {t("site.suggestion.matchesClient")}
                  </span>
                </>
              ) : (
                <>
                  <Globe size={12} className="text-primary-600" />
                  <span className="text-xs font-semibold text-primary-700">
                    {t("site.suggestion.suggestion")}
                  </span>
                </>
              )}
              {currentSite?.isWorkRelated && !isSmartMatch && (
                <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded-full font-medium">
                  {t(`site.category.${categoryKey}`)}
                </span>
              )}
              {isSmartMatch && matchConfidence && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                    matchConfidence >= 0.8
                      ? "bg-primary-100 text-primary-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {formatConfidence(matchConfidence)}
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {suggestedProject.name}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] truncate flex items-center gap-1">
              {isSmartMatch && matchReason ? (
                <span>{matchReason}</span>
              ) : (
                <>
                  <span>{currentSite?.domain}</span>
                  {confidencePercent >= 80 && (
                    <span className="text-primary-700">
                      {t("site.suggestion.sure", {
                        percent: confidencePercent,
                      })}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        </button>

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              if (currentSite) dismissSuggestion(currentSite.domain);
            }}
            className="p-1.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-sunken)] rounded-lg transition-colors"
            title={t("site.suggestion.dismiss")}
            aria-label={t("site.suggestion.dismiss")}
          >
            <X size={14} />
          </button>
          {mayRelabel && (
            <button
              type="button"
              onClick={handleSelect}
              className="p-1.5 text-primary-600 hover:text-primary-700 hover:bg-primary-100 rounded-lg transition-colors"
              title={t("site.suggestion.pickProject")}
              aria-label={t("site.suggestion.pickProject")}
            >
              <ArrowRight size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={handlePlayStart}
            disabled={isSyncing}
            className="flex items-center gap-1 p-1.5 text-primary-600 hover:text-primary-700 hover:bg-primary-100 disabled:opacity-50 rounded-lg transition-colors"
            title={
              mayRelabel
                ? t("site.suggestion.startTimer")
                : t("site.suggestion.saveAndStart", {
                    name: suggestedProject.name,
                  })
            }
            aria-label={
              mayRelabel
                ? t("site.suggestion.startTimer")
                : t("site.suggestion.saveAndStart", {
                    name: suggestedProject.name,
                  })
            }
          >
            <Play size={16} fill="currentColor" />
            {!mayRelabel && (
              <span className="text-xs font-medium">
                {t("site.suggestion.stopAndStart")}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
