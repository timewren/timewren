import { useState } from "react";
import { suggestionMayRelabel } from "../../../lib/stop-save";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useSiteStore } from "../../../stores/siteStore";
import { useTimerStore } from "../../../stores/timerStore";
import { QuickEntry } from "../QuickEntry";
import { SiteSuggestion } from "../SiteSuggestion";
import { Timer } from "../Timer";

export function TimerTab() {
  // Mens Hurtig registrering er åben, foldes timeren sammen til tid og
  // knapper, så de to "Vælg kunde"-felter ikke står oven over hinanden.
  const [quickEntryOpen, setQuickEntryOpen] = useState(false);
  const timer = useTimerStore((s) => s.timer);
  const updateProject = useTimerStore((s) => s.updateProject);
  const { addMapping, currentSite } = useSiteStore();
  const { settings } = useSettingsStore();

  const handleProjectSelect = (projectId: string, clientId: string) => {
    if (currentSite) {
      addMapping(currentSite.domain, projectId, clientId);
    }
    // Et forslag må aldrig flytte en session med reel tid til en anden
    // kunde (kunde A: "timeren skifter pludselig kunde"). Kortet tilbyder i
    // stedet "stop & start" — se SiteSuggestion.
    const { displayTime } = useTimerStore.getState();
    const hasSession = !!timer?.isRunning || displayTime > 0;
    if (hasSession && !suggestionMayRelabel(displayTime)) return;
    updateProject(projectId, clientId);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {settings.showSiteSuggestions && (
        <SiteSuggestion
          onSelectProject={handleProjectSelect}
          currentProjectId={timer?.projectId || null}
        />
      )}
      <Timer collapsed={quickEntryOpen} />
      <QuickEntry onOpenChange={setQuickEntryOpen} />
    </div>
  );
}
