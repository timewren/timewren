import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const appWindow = getCurrentWindow();

function MacOSTrafficLights() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 pl-3">
      <button
        type="button"
        onClick={() => appWindow.close()}
        aria-label={t("titlebar.closeWindow")}
        className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] transition-colors hover:bg-[#ff4136]"
      >
        <X
          size={8}
          strokeWidth={2.5}
          className="text-[#4d0000] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
      <button
        type="button"
        onClick={() => appWindow.minimize()}
        aria-label={t("titlebar.minimizeWindow")}
        className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] transition-colors hover:bg-[#f5a623]"
      >
        <Minus
          size={8}
          strokeWidth={2.5}
          className="text-[#995700] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
      <button
        type="button"
        onClick={() => appWindow.toggleMaximize()}
        aria-label={t("titlebar.maximizeWindow")}
        className="group flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] transition-colors hover:bg-[#1aab29]"
      >
        <Square
          size={6}
          strokeWidth={2.5}
          className="text-[#006500] opacity-0 transition-opacity group-hover:opacity-100"
        />
      </button>
    </div>
  );
}

function WindowsControls() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full">
      <button
        type="button"
        onClick={() => appWindow.minimize()}
        aria-label={t("titlebar.minimizeWindow")}
        className="flex h-full w-11 items-center justify-center text-(--color-text-muted) transition-colors hover:bg-(--color-border)"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={() => appWindow.toggleMaximize()}
        aria-label={t("titlebar.maximizeWindow")}
        className="flex h-full w-11 items-center justify-center text-(--color-text-muted) transition-colors hover:bg-(--color-border)"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        onClick={() => appWindow.close()}
        aria-label={t("titlebar.closeWindow")}
        className="flex h-full w-11 items-center justify-center text-(--color-text-muted) transition-colors hover:bg-red-500 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Titlebar() {
  const [platform, setPlatform] = useState<string>("windows");

  useEffect(() => {
    invoke<string>("get_platform")
      .then(setPlatform)
      .catch(() => {
        // Fallback to windows if the command fails
      });
  }, []);

  const isMac = platform === "macos";

  return (
    <div
      data-tauri-drag-region
      className="flex h-9 items-center justify-between border-b border-(--color-border) bg-(--color-surface)"
    >
      {isMac ? (
        <>
          <MacOSTrafficLights />
          <div
            data-tauri-drag-region
            className="flex flex-1 items-center justify-center"
          >
            <span className="text-xs font-semibold tracking-wide text-(--color-text-muted)">
              TimeTrack
            </span>
          </div>
          {/* Spacer to balance the traffic lights */}
          <div className="w-[68px]" />
        </>
      ) : (
        <>
          <div data-tauri-drag-region className="flex items-center gap-2 pl-3">
            <span className="text-xs font-semibold tracking-wide text-(--color-text-muted)">
              TimeTrack
            </span>
          </div>
          <WindowsControls />
        </>
      )}
    </div>
  );
}
