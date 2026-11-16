import { getVersion } from "@tauri-apps/api/app";
import { CheckCircle2, Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";

interface UpdateInfo {
  version: string;
  body: string | null;
  date: string | null;
}

type CheckStatus = "idle" | "checking" | "upToDate" | "available" | "error";

/**
 * The updater's `date` is a string like "2026-07-01 12:00:00.0 +00:00:00".
 * Extract the date part and format it with the app's locale; fall back to
 * the raw string if the format is unexpected.
 */
function formatUpdaterDate(raw: string): string {
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? formatDate(match[0]) : raw;
}

type NotesBlock =
  | { key: string; type: "paragraph"; text: string }
  | { key: string; type: "list"; items: { key: string; text: string }[] };

/**
 * Minimal markdown-ish parsing of release notes: blank lines separate
 * paragraphs, and "- " / "* " lines become bullet lists. No markdown
 * library, no HTML injection — everything renders as plain text.
 */
function parseReleaseNotes(body: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({
        key: `block-${blocks.length}`,
        type: "paragraph",
        text: paragraph.join(" "),
      });
      paragraph = [];
    }
  };

  for (const rawLine of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      flushParagraph();
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)/);
    if (bullet) {
      flushParagraph();
      const last = blocks[blocks.length - 1];
      if (last && last.type === "list") {
        last.items.push({ key: `item-${last.items.length}`, text: bullet[1] });
      } else {
        blocks.push({
          key: `block-${blocks.length}`,
          type: "list",
          items: [{ key: "item-0", text: bullet[1] }],
        });
      }
    } else {
      // Strip markdown heading markers so headings render as plain text
      paragraph.push(line.replace(/^#+\s*/, ""));
    }
  }
  flushParagraph();
  return blocks;
}

export function UpdateSettings() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("");
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion("0.1.0"));
  }, []);

  const checkForUpdate = useCallback(async () => {
    setStatus("checking");
    setInstallError(null);
    try {
      const info = await tauriInvoke<UpdateInfo | null>("check_for_update");
      if (info) {
        setUpdate(info);
        setStatus("available");
      } else {
        setUpdate(null);
        setStatus("upToDate");
      }
    } catch {
      setUpdate(null);
      setStatus("error");
    }
  }, []);

  // Check automatically when the section is opened — never auto-install.
  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  async function handleInstall() {
    setInstalling(true);
    setInstallError(null);
    try {
      // Downloads, installs and relaunches into the new version. On success
      // the app restarts, so we never reset the installing state here.
      await tauriInvoke("install_update");
    } catch (err) {
      // Re-enable the button so the user can retry.
      setInstalling(false);
      setInstallError(String(err));
    }
  }

  return (
    <div className="space-y-8">
      {/* Current version */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-(--color-accent)/10">
          <RefreshCw size={18} className="text-(--color-accent)" />
        </div>
        <div>
          <p className="text-sm font-semibold text-(--color-text)">
            {t("updates.currentVersion")}
          </p>
          <p className="text-xs text-(--color-text-muted)">
            TimeTrack Desktop v{appVersion}
          </p>
        </div>
      </div>

      {/* Check for updates */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("updates.checkTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {t("updates.checkDescription")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={checkForUpdate}
            disabled={status === "checking" || installing}
          >
            {status === "checking" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {status === "checking"
              ? t("updates.checking")
              : t("updates.checkButton")}
          </Button>
          {status === "upToDate" && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={14} className="shrink-0" />
              {t("updates.upToDate")}
            </span>
          )}
          {status === "error" && (
            <span className="text-xs text-red-400">
              {t("updates.checkFailed")}
            </span>
          )}
        </div>
      </section>

      {/* Available update */}
      {status === "available" && update && (
        <section className="space-y-3 rounded-lg border border-(--color-border) bg-(--color-bg) p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-(--color-text)">
                {t("updates.availableTitle")}
              </p>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">
                {t("updates.newVersion", { version: update.version })}
                {update.date &&
                  ` · ${t("updates.releasedOn", { date: formatUpdaterDate(update.date) })}`}
              </p>
            </div>
            <Button size="sm" onClick={handleInstall} disabled={installing}>
              {installing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {installing
                ? t("updates.installing")
                : t("updates.installButton")}
            </Button>
          </div>

          {installError && (
            <p className="text-xs text-red-400">
              {t("updates.installFailed", { error: installError })}
            </p>
          )}

          {update.body && (
            <div className="border-t border-(--color-border) pt-3">
              <p className="mb-2 text-xs font-semibold text-(--color-text)">
                {t("updates.releaseNotes")}
              </p>
              <div className="space-y-2 text-xs text-(--color-text-muted)">
                {parseReleaseNotes(update.body).map((block) =>
                  block.type === "list" ? (
                    <ul key={block.key} className="list-disc space-y-1 pl-4">
                      {block.items.map((item) => (
                        <li key={item.key}>{item.text}</li>
                      ))}
                    </ul>
                  ) : (
                    <p key={block.key}>{block.text}</p>
                  ),
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
