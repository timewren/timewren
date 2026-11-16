import { Check, Globe, Loader2, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { tauriInvoke } from "@/lib/tauri";

interface BrowserStatus {
  chrome: boolean;
  edge: boolean;
  firefox: boolean;
}

interface BrowserInfo {
  key: keyof BrowserStatus;
  name: string;
  icon: React.ReactNode;
  storeName: string;
}

export function BrowserExtensionSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const result = await tauriInvoke<BrowserStatus>(
        "get_browser_extension_status",
      );
      setStatus(result);
    } catch {
      setStatus({ chrome: false, edge: false, firefox: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleRegister() {
    setRegistering(true);
    setMessage(null);
    try {
      const result = await tauriInvoke<string>("register_browser_extension");
      setMessage({ text: result, type: "success" });
      // Reload status
      await loadStatus();
    } catch (err) {
      setMessage({ text: String(err), type: "error" });
    } finally {
      setRegistering(false);
    }
  }

  const browsers: BrowserInfo[] = [
    {
      key: "chrome",
      name: "Chrome",
      icon: <Globe size={16} />,
      storeName: "Chrome Web Store",
    },
    {
      key: "edge",
      name: "Edge",
      icon: <Globe size={16} />,
      storeName: "Edge Add-ons",
    },
    {
      key: "firefox",
      name: "Firefox",
      icon: <Globe size={16} />,
      storeName: "Firefox Add-ons",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Description */}
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("browserExtension.title")}
          </h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted) max-w-lg">
            {t("browserExtension.description")}
          </p>
        </div>
      </section>

      {/* Browser status cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("browserExtension.status")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={loadStatus}
            disabled={loading}
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {t("browserExtension.refresh")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2
              size={20}
              className="animate-spin text-(--color-text-muted)"
            />
          </div>
        ) : (
          <div className="space-y-2">
            {browsers.map((browser) => {
              const isRegistered = status?.[browser.key] ?? false;

              return (
                <div
                  key={browser.key}
                  className="flex items-center justify-between rounded-lg border border-(--color-border) bg-(--color-bg) px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-(--color-text-muted)">
                      {browser.icon}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-(--color-text)">
                        {browser.name}
                      </p>
                      <span className="flex items-center gap-1.5 text-[10px] text-(--color-text-muted)">
                        {browser.storeName}
                        <span className="rounded-full bg-(--color-border) px-1.5 py-0.5 font-medium">
                          {t("browserExtension.comingSoon")}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRegistered ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-medium text-emerald-400 ring-1 ring-emerald-500/30">
                        <Check size={10} />
                        {t("browserExtension.registered")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-full bg-(--color-border)/50 px-2.5 py-1 text-[10px] font-medium text-(--color-text-muted) ring-1 ring-(--color-border)">
                        <X size={10} />
                        {t("browserExtension.notRegistered")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Register button */}
      <section className="space-y-3">
        <Button
          variant="primary"
          size="md"
          onClick={handleRegister}
          disabled={registering}
        >
          {registering ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t("browserExtension.registering")}
            </>
          ) : (
            t("browserExtension.registerAll")
          )}
        </Button>
        <p className="text-xs text-(--color-text-muted)">
          {t("browserExtension.registerHint")}
        </p>
      </section>

      {/* Message */}
      {message && (
        <div
          className={`rounded-lg border p-3 ${
            message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <p
            className={`text-xs ${
              message.type === "success" ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {message.text}
          </p>
        </div>
      )}
    </div>
  );
}
