import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useT } from "../../i18n";
import { useAuthStore } from "../../stores/authStore";
import { useTimerStore } from "../../stores/timerStore";

export function OrgSwitcher() {
  const { t } = useT();
  const { organizations, selectedOrgId, setSelectedOrg } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [warn, setWarn] = useState(false);
  const queryClient = useQueryClient();

  // A pending timer is tied to the org its project/client belongs to. Switching
  // org would make the eventual stop-save target a tenant the project does not
  // exist in, and the server rejects it ("Projekt ikke fundet"). Block the
  // switch whenever a project/client-bound timer has accumulated time —
  // running OR paused (a paused timer keeps its time in baseSeconds/
  // elapsedSeconds and would fail the same way on save). A project-less timer
  // is safe to carry across orgs.
  const blockSwitch = useTimerStore(
    (s) =>
      !!(s.timer?.projectId || s.timer?.clientId) &&
      (!!s.timer?.isRunning ||
        (s.timer?.baseSeconds ?? 0) > 0 ||
        (s.timer?.elapsedSeconds ?? 0) > 0),
  );

  // Only relevant when the user belongs to more than one organization.
  if (organizations.length < 2) return null;

  const selected = organizations.find((o) => o.id === selectedOrgId);

  const handleSelect = async (orgId: string) => {
    if (orgId === selectedOrgId) {
      setOpen(false);
      return;
    }
    if (blockSwitch) {
      // Keep the dropdown open and explain why the switch was refused.
      setWarn(true);
      return;
    }
    setOpen(false);
    await setSelectedOrg(orgId);
    // Cached projects/clients/entries belong to the previous org — refetch.
    await queryClient.invalidateQueries();
    await chrome.storage.local.remove(["cachedClients", "cachedProjects"]);
  };

  const toggleOpen = () => {
    setOpen((v) => {
      if (v) setWarn(false); // reset the warning when closing
      return !v;
    });
  };

  return (
    <div className="relative px-4 py-2 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-subtle)]">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-label={t("popup.org.label", {
          name: selected?.name ?? t("popup.org.none"),
        })}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-3 py-2 text-sm text-[var(--color-text-primary)] hover:border-primary-500 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 size={15} className="text-[var(--color-text-tertiary)]" />
          <span className="truncate">
            {selected?.name ?? t("popup.org.choose")}
          </span>
        </span>
        <ChevronDown size={15} className="text-[var(--color-text-tertiary)]" />
      </button>

      {open && (
        <div className="absolute left-4 right-4 z-20 mt-1 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-elevated)] shadow-lg">
          {warn && (
            <p
              role="alert"
              className="px-3 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200 first:rounded-t-lg"
            >
              {t("popup.org.stopFirst")}
            </p>
          )}
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => handleSelect(org.id)}
              aria-current={org.id === selectedOrgId ? "true" : undefined}
              className={`flex w-full items-center px-3 py-2.5 text-sm transition-colors hover:bg-[var(--color-surface-sunken)] first:rounded-t-lg last:rounded-b-lg ${
                org.id === selectedOrgId
                  ? "text-primary-600 font-semibold"
                  : "text-[var(--color-text-secondary)]"
              }`}
            >
              <span className="truncate">{org.name}</span>
              {org.id === selectedOrgId && (
                <Check size={15} className="ml-auto" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
