import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  FolderOpen,
  Info,
  Keyboard,
  LayoutDashboard,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scale,
  Search,
  Settings,
  Square,
  Sun,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerLoadError } from "@/components/ui/PickerLoadError";
import { useProjectClientPicker } from "@/hooks/useProjectClientPicker";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTimerStore } from "@/stores/timerStore";
import { AboutDialog } from "./AboutDialog";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { LicensesDialog } from "./LicensesDialog";
import { ShortcutBadge } from "./ShortcutKeys";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isRunning, start, stop } = useTimerStore();
  const { theme, setTheme, trackingPaused, setTrackingPaused } =
    useSettingsStore();

  // Keyboard listener for Ctrl+K and "?" (the shortcut overview)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }

      // "?" opens the shortcut overview. Without this guard every question
      // mark typed into a field — a project description, a search box — would
      // throw a dialog over the form the user is filling in.
      if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      // Two dialogs stacked on top of each other help nobody.
      if (document.querySelector('[role="dialog"]')) return;

      e.preventDefault();
      setShortcutsOpen(true);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Projekter og kunder hentes, når paletten åbner — ikke ved mount, fordi den
  // er en genvej, ikke en side. Hooken henter dem begge og udelukker de
  // arkiverede, så paletten viser præcis dem, der kan vælges.
  const {
    projects: alleProjects,
    clients: alleClients,
    loadFailed,
    retry,
  } = useProjectClientPicker({ active: open });
  const projects = alleProjects.filter((p) => !p.is_archived);
  const clients = alleClients.filter((c) => !c.is_archived);

  const runAction = useCallback((action: () => void) => {
    action();
    setOpen(false);
  }, []);

  const navigateTo = useCallback(
    (path: string) => {
      runAction(() => navigate({ to: path }));
    },
    [navigate, runAction],
  );

  const toggleTheme = useCallback(() => {
    runAction(() => setTheme(theme === "dark" ? "light" : "dark"));
  }, [theme, setTheme, runAction]);

  const toggleTracking = useCallback(() => {
    runAction(() => setTrackingPaused(!trackingPaused));
  }, [trackingPaused, setTrackingPaused, runAction]);

  const handleStartTimer = useCallback(() => {
    runAction(() => {
      start().catch(() => {});
    });
  }, [start, runAction]);

  const handleStopTimer = useCallback(() => {
    runAction(() => {
      stop().catch(() => {});
    });
  }, [stop, runAction]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <Command.Dialog
            open={open}
            onOpenChange={setOpen}
            label={t("commandPalette.label")}
            loop
            className="fixed inset-0 z-50"
            overlayClassName="fixed inset-0"
            contentClassName="fixed inset-0"
          >
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="fixed inset-x-0 top-[20vh] z-50 mx-auto w-full max-w-lg"
            >
              <div className="overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface)/95 shadow-2xl backdrop-blur-lg">
                {/* Search input */}
                <div className="flex items-center gap-3 border-b border-(--color-border) px-4">
                  <Search
                    size={16}
                    className="shrink-0 text-(--color-text-muted)"
                  />
                  <Command.Input
                    placeholder={t("commandPalette.searchPlaceholder")}
                    className="h-12 w-full bg-transparent text-sm text-(--color-text) outline-none placeholder:text-(--color-text-muted)"
                  />
                  <kbd className="shrink-0 rounded border border-(--color-border) px-1.5 py-0.5 font-mono text-[10px] text-(--color-text-muted)">
                    ESC
                  </kbd>
                </div>

                {/* En fejlet hentning var her helt stille, og søgningen så ud som
                    om brugeren ikke har de projekter og kunder, han har. De
                    handlinger der ikke er lister — navigation, tema, timeren —
                    virker stadig, så beskeden står over listen og ikke i den. */}
                {loadFailed && (
                  <div className="px-2 pt-2">
                    <PickerLoadError kind={loadFailed} onRetry={retry} />
                  </div>
                )}

                {/* Command list */}
                <Command.List className="max-h-80 overflow-y-auto overscroll-contain p-2">
                  <Command.Empty className="px-3 py-8 text-center text-sm text-(--color-text-muted)">
                    {t("commandPalette.noResults")}
                  </Command.Empty>

                  {/* Navigation */}
                  <Command.Group
                    heading={t("commandPalette.groupNavigation")}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-(--color-text-muted)"
                  >
                    <CommandItem
                      icon={<LayoutDashboard size={16} />}
                      onSelect={() => navigateTo("/")}
                      shortcut="Ctrl+1"
                    >
                      {t("nav.dashboard")}
                    </CommandItem>
                    <CommandItem
                      icon={<CalendarDays size={16} />}
                      onSelect={() => navigateTo("/calendar")}
                      shortcut="Ctrl+2"
                    >
                      {t("nav.calendar")}
                    </CommandItem>
                    <CommandItem
                      icon={<Clock size={16} />}
                      onSelect={() => navigateTo("/timeline")}
                      shortcut="Ctrl+3"
                    >
                      {t("nav.timeline")}
                    </CommandItem>
                    <CommandItem
                      icon={<FolderOpen size={16} />}
                      onSelect={() => navigateTo("/projects")}
                      shortcut="Ctrl+4"
                    >
                      {t("nav.projects")}
                    </CommandItem>
                    <CommandItem
                      icon={<CreditCard size={16} />}
                      onSelect={() => navigateTo("/klippekort")}
                      shortcut="Ctrl+5"
                    >
                      {t("nav.klippekort")}
                    </CommandItem>
                    <CommandItem
                      icon={<FileText size={16} />}
                      onSelect={() => navigateTo("/invoices")}
                      shortcut="Ctrl+6"
                    >
                      {t("nav.invoices")}
                    </CommandItem>
                    <CommandItem
                      icon={<Settings size={16} />}
                      onSelect={() => navigateTo("/settings")}
                      shortcut="Ctrl+,"
                    >
                      {t("nav.settings")}
                    </CommandItem>
                  </Command.Group>

                  {/* Timer */}
                  <Command.Group
                    heading={t("commandPalette.groupTimer")}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-(--color-text-muted)"
                  >
                    {!isRunning && (
                      <CommandItem
                        icon={<Play size={16} />}
                        onSelect={handleStartTimer}
                        shortcut="Ctrl+Shift+T"
                      >
                        {t("commandPalette.startTimer")}
                      </CommandItem>
                    )}
                    {isRunning && (
                      <CommandItem
                        icon={<Square size={16} />}
                        onSelect={handleStopTimer}
                        shortcut="Ctrl+Shift+S"
                      >
                        {t("commandPalette.stopTimer")}
                      </CommandItem>
                    )}
                  </Command.Group>

                  {/* Quick actions */}
                  <Command.Group
                    heading={t("commandPalette.groupQuick")}
                    className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-(--color-text-muted)"
                  >
                    <CommandItem
                      icon={<Plus size={16} />}
                      onSelect={() => navigateTo("/timeline")}
                      keywords={["ny", "registrering", "time", "entry"]}
                      shortcut="Ctrl+N"
                    >
                      {t("timeEntry.newEntry")}
                    </CommandItem>
                    <CommandItem
                      icon={
                        theme === "dark" ? (
                          <Sun size={16} />
                        ) : (
                          <Moon size={16} />
                        )
                      }
                      onSelect={toggleTheme}
                      keywords={[
                        "tema",
                        "theme",
                        "mørk",
                        "lys",
                        "dark",
                        "light",
                      ]}
                    >
                      {t("commandPalette.switchToTheme", {
                        theme: t(
                          theme === "dark"
                            ? "commandPalette.themeDark"
                            : "commandPalette.themeLight",
                        ),
                      })}
                    </CommandItem>
                    <CommandItem
                      icon={
                        trackingPaused ? (
                          <RotateCcw size={16} />
                        ) : (
                          <Pause size={16} />
                        )
                      }
                      onSelect={toggleTracking}
                      keywords={["pause", "genoptag", "tracking", "sporing"]}
                    >
                      {t(
                        trackingPaused
                          ? "commandPalette.resumeTracking"
                          : "commandPalette.pauseTracking",
                      )}
                    </CommandItem>
                    <CommandItem
                      icon={<Info size={16} />}
                      onSelect={() => runAction(() => setAboutOpen(true))}
                      keywords={["om", "about", "version", "info"]}
                    >
                      {t("about.title")}
                    </CommandItem>
                    <CommandItem
                      icon={<Scale size={16} />}
                      onSelect={() => runAction(() => setLicensesOpen(true))}
                      keywords={["licenser", "licenses", "open source", "oss"]}
                    >
                      {t("about.licenses")}
                    </CommandItem>
                    <CommandItem
                      icon={<Keyboard size={16} />}
                      onSelect={() => runAction(() => setShortcutsOpen(true))}
                      keywords={[
                        "genveje",
                        "tastatur",
                        "shortcuts",
                        "keyboard",
                        "taster",
                      ]}
                      shortcut="?"
                    >
                      {t("shortcuts.title")}
                    </CommandItem>
                  </Command.Group>

                  {/* Projects */}
                  {projects.length > 0 && (
                    <Command.Group
                      heading={t("nav.projects")}
                      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-(--color-text-muted)"
                    >
                      {projects.map((project) => (
                        <CommandItem
                          key={project.id}
                          value={`projekt-${project.name}`}
                          icon={
                            <span
                              className="inline-block h-3 w-3 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  project.color || "var(--color-accent)",
                              }}
                            />
                          }
                          onSelect={() => navigateTo("/projects")}
                          keywords={[
                            project.name,
                            project.client_name || "",
                            "projekt",
                            "project",
                          ]}
                        >
                          <span>{project.name}</span>
                          {project.client_name && (
                            <span className="ml-1 text-xs text-(--color-text-muted)">
                              — {project.client_name}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </Command.Group>
                  )}

                  {/* Clients */}
                  {clients.length > 0 && (
                    <Command.Group
                      heading={t("projects.clients")}
                      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-(--color-text-muted)"
                    >
                      {clients.map((client) => (
                        <CommandItem
                          key={client.id}
                          value={`klient-${client.name}`}
                          icon={<Users size={16} />}
                          onSelect={() => navigateTo("/projects")}
                          keywords={[
                            client.name,
                            client.company || "",
                            client.email || "",
                            "klient",
                            "client",
                            "kunde",
                          ]}
                        >
                          <span>{client.name}</span>
                          {client.company && (
                            <span className="ml-1 text-xs text-(--color-text-muted)">
                              — {client.company}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </Command.Group>
                  )}
                </Command.List>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-(--color-border) px-4 py-2">
                  <span className="text-[11px] text-(--color-text-muted)">
                    {t("commandPalette.label")}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-(--color-text-muted)">
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-(--color-border) px-1 font-mono text-[10px]">
                        ↑↓
                      </kbd>{" "}
                      {t("commandPalette.hintNavigate")}
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-(--color-border) px-1 font-mono text-[10px]">
                        ↵
                      </kbd>{" "}
                      {t("commandPalette.hintSelect")}
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          </Command.Dialog>
        )}
      </AnimatePresence>

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onOpenLicenses={() => setLicensesOpen(true)}
      />
      <LicensesDialog
        open={licensesOpen}
        onClose={() => setLicensesOpen(false)}
      />
      <KeyboardShortcutsDialog
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </>
  );
}

// Shared item component for consistent styling
function CommandItem({
  children,
  icon,
  onSelect,
  shortcut,
  value,
  keywords,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
  shortcut?: string;
  value?: string;
  keywords?: string[];
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-(--color-text) data-[selected=true]:bg-(--color-accent)/10 data-[selected=true]:text-(--color-text)"
    >
      <span className="flex shrink-0 items-center text-(--color-text-muted)">
        {icon}
      </span>
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <ShortcutBadge keys={shortcut} />}
    </Command.Item>
  );
}
