import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import {
  IDLE_PROMPT_ANSWER,
  IDLE_PROMPT_KEY,
  type IdlePrompt,
  type IdlePromptAnswer,
  readIdlePrompt,
} from "../../lib/idle-prompt";
import { InlineConfirm } from "./InlineConfirm";

/**
 * Spørgsmålet efter inaktivitet. Firefox viser ingen knapper på
 * notifikationen, så et klik på den åbner popup'en, som spørger her.
 */
export function IdlePromptBanner({ className = "" }: { className?: string }) {
  const { t } = useT();
  const [prompt, setPrompt] = useState<IdlePrompt | null>(null);

  useEffect(() => {
    const read = () =>
      void chrome.storage.local
        .get([IDLE_PROMPT_KEY])
        .then((stored) => setPrompt(readIdlePrompt(stored[IDLE_PROMPT_KEY])))
        .catch(() => setPrompt(null));
    read();
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && IDLE_PROMPT_KEY in changes) read();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  if (!prompt) return null;

  const answer = (value: IdlePromptAnswer) => {
    setPrompt(null);
    void chrome.runtime
      .sendMessage({ type: IDLE_PROMPT_ANSWER, answer: value })
      .catch(() => {});
  };

  if (prompt.kind === "paused") {
    return (
      <InlineConfirm
        className={className}
        message={t("popup.idle.pausedMessage", {
          clock: prompt.clock,
          away: prompt.away,
        })}
        details={[t("popup.idle.pausedDetail")]}
        confirmLabel={t("popup.idle.resume")}
        cancelLabel={t("popup.idle.close")}
        onConfirm={() => answer("resume")}
        onCancel={() => answer("dismiss")}
      />
    );
  }
  return (
    <InlineConfirm
      className={className}
      message={t("popup.idle.awayMessage", {
        away: prompt.away,
        clock: prompt.clock,
      })}
      details={[t("popup.idle.awayDetail")]}
      confirmLabel={t("popup.idle.discard", { away: prompt.away })}
      cancelLabel={t("popup.idle.keep")}
      onConfirm={() => answer("discard")}
      onCancel={() => answer("keep")}
    />
  );
}
