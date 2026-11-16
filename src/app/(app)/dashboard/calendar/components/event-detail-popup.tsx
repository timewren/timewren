import { Check, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import type { TimeBlock } from "../types";
import { formatTime } from "../utils/calendar-math";

export function EventDetailPopup({
  block,
  onClose,
  onStartTimer,
  onCreateEntry,
  onEditEntry,
  onDeleteEntry,
  onContinueAsSegment,
  onNewEntryForTask,
}: {
  block: TimeBlock;
  onClose: () => void;
  onStartTimer: (block: TimeBlock) => void;
  onCreateEntry: (block: TimeBlock) => void;
  onEditEntry?: (block: TimeBlock) => void;
  onDeleteEntry?: (block: TimeBlock) => void;
  onContinueAsSegment?: (block: TimeBlock) => void;
  onNewEntryForTask?: (block: TimeBlock) => void;
}) {
  const t = useTranslations("calendar");
  const popupRef = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState({ x: false, y: false });

  useLayoutEffect(() => {
    const el = popupRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const flipX = rect.right > window.innerWidth;
    const flipY = rect.bottom > window.innerHeight;
    if (flipX || flipY) {
      setFlip({ x: flipX, y: flipY });
    }
  }, []);

  const durationMins = Math.round(
    (block.endTime.getTime() - block.startTime.getTime()) / 60000,
  );
  const hours = Math.floor(durationMins / 60);
  const mins = durationMins % 60;
  const isPast = block.endTime < new Date();
  const isEvent = block.type === "event";
  const isEntry = block.type === "entry";
  const hasLinkedEntry = !!block.linkedTimeEntryId;

  const positionClasses = [
    flip.y ? "bottom-full top-auto mb-2" : "top-full mt-2",
    flip.x
      ? "right-0 left-auto sm:right-full sm:left-auto sm:mr-2"
      : "left-0 sm:left-full sm:top-0 sm:mt-0 sm:ml-2",
  ].join(" ");

  return (
    <div
      ref={popupRef}
      className={`absolute ${positionClasses} z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          {block.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-1.5 space-y-1 text-xs text-gray-500 dark:text-gray-400">
        <p>
          {formatTime(block.startTime)} – {formatTime(block.endTime)}
          {" · "}
          {hours > 0 ? `${hours}${t("units.hour")} ` : ""}
          {mins > 0 ? `${mins}${t("units.minute")}` : ""}
        </p>
        {block.projectName && (
          <p>{t("popup.project", { name: block.projectName })}</p>
        )}
        {block.clientName && (
          <p>{t("popup.client", { name: block.clientName })}</p>
        )}
        {block.responseStatus && (
          <p>
            {t("popup.status", {
              status:
                block.responseStatus === "accepted"
                  ? t("popup.accepted")
                  : block.responseStatus === "declined"
                    ? t("popup.declined")
                    : block.responseStatus === "tentative"
                      ? t("popup.tentative")
                      : block.responseStatus,
            })}
          </p>
        )}
      </div>

      {/* Google Calendar event — timer/convert actions */}
      {isEvent && !hasLinkedEntry && (
        <div className="mt-3 flex gap-1.5">
          {!isPast ? (
            <button
              type="button"
              onClick={() => onStartTimer(block)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-tt-gran px-2.5 py-1.5 text-xs font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              <Play className="h-3 w-3" />
              {t("popup.startTimer")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onCreateEntry(block)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700"
            >
              <Plus className="h-3 w-3" />
              {t("popup.logTime")}
            </button>
          )}
        </div>
      )}

      {isEvent && hasLinkedEntry && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <Check className="h-3.5 w-3.5" />
          {t("popup.alreadyLogged")}
        </div>
      )}

      {/* Time entry — edit/delete actions */}
      {isEntry && (onEditEntry || onDeleteEntry) && (
        <div className="mt-3 flex gap-1.5">
          {onEditEntry && (
            <button
              type="button"
              onClick={() => onEditEntry(block)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-tt-gran px-2.5 py-1.5 text-xs font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              <Pencil className="h-3 w-3" />
              {t("popup.edit")}
            </button>
          )}
          {onDeleteEntry && (
            <button
              type="button"
              onClick={() => onDeleteEntry(block)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:bg-transparent dark:text-red-400 dark:hover:bg-red-950/30"
              title={t("popup.deleteEntry")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* Time entry with task — continue/new-entry actions */}
      {isEntry &&
        block.taskId &&
        (onContinueAsSegment || onNewEntryForTask) && (
          <div className="mt-2 flex gap-1.5">
            {onContinueAsSegment && (
              <button
                type="button"
                onClick={() => {
                  onContinueAsSegment(block);
                  onClose();
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700"
              >
                <Play className="h-3 w-3" />
                {t("popup.resume")}
              </button>
            )}
            {onNewEntryForTask && (
              <button
                type="button"
                onClick={() => {
                  onNewEntryForTask(block);
                  onClose();
                }}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Plus className="h-3 w-3" />
                {t("popup.newEntry")}
              </button>
            )}
          </div>
        )}
    </div>
  );
}
