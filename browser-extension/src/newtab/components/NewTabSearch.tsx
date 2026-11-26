import { Search } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useT } from "../../i18n";
import { latestOnly, searchInCurrentTab } from "../../lib/native-newtab";

/**
 * Ny fane, når TimeTrack er slået fra i en browser, hvis egen nye fane ikke kan
 * nås (Edge, Firefox m.fl., se lib/native-newtab.ts). Søgningen går til
 * browserens standardsøgemaskine via chrome.search.query, i samme fane. Kan
 * søgningen ikke startes (fx ingen standardsøgemaskine), siges det under feltet.
 */
export function NewTabSearch() {
  const { t } = useT();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const latest = useRef(latestOnly()).current;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = text.trim();
    if (!query) return;
    setFailed(false);
    const isCurrent = latest.next();
    void searchInCurrentTab(query).then((ok) => {
      if (isCurrent()) setFailed(!ok);
    });
  };

  return (
    <search className="w-full max-w-xl">
      <form
        onSubmit={submit}
        className="flex items-center gap-2 px-4 py-3 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] focus-within:ring-2 focus-within:ring-primary-500"
      >
        <Search
          size={18}
          aria-hidden="true"
          className="shrink-0 text-[var(--color-text-muted)]"
        />
        <input
          type="search"
          // Som browserens egen nye fane: man kan skrive med det samme.
          // biome-ignore lint/a11y/noAutofocus: søgefeltet er sidens eneste formål
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            latest.cancel();
            setFailed(false);
          }}
          aria-label={t("newtab.search.label")}
          placeholder={t("newtab.search.label")}
          // Fokus vises som ring om hele feltet (formen); den globale
          // :focus-visible-kant ville ellers tegne en ring inden i ringen.
          style={{ outline: "none" }}
          className="flex-1 min-w-0 bg-transparent text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
        <button
          type="submit"
          className="shrink-0 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          {t("newtab.search.submit")}
        </button>
      </form>
      <p
        role="alert"
        className="min-h-5 mt-3 px-4 text-sm text-[var(--color-text-secondary)]"
      >
        {failed ? t("newtab.search.error") : null}
      </p>
    </search>
  );
}
