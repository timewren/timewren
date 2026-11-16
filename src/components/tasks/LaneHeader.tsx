"use client";

import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  ArrowLeft,
  ArrowRight,
  ChevronsLeft,
  MoreVertical,
  Palette,
  Pencil,
  Settings2,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { LaneCategory } from "@/lib/kanban/lane-category";
import { trpc } from "@/providers/trpc-provider";
import { LANE_COLORS } from "./lane-colors";

interface LaneHeaderProps {
  laneId: string;
  laneName: string;
  laneColor: string;
  laneCategory?: LaneCategory;
  taskCount: number;
  onDeleteRequest: (laneId: string) => void;
  onChange: () => void;
  onMove?: (laneId: string, delta: -1 | 1) => void;
  canMoveLeft?: boolean;
  canMoveRight?: boolean;
  onCollapse?: () => void;
  onOpenSettings?: () => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
}

const MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700";

export function LaneHeader({
  laneId,
  laneName,
  laneColor,
  laneCategory,
  taskCount,
  onDeleteRequest,
  onChange,
  onMove,
  canMoveLeft = false,
  canMoveRight = false,
  onCollapse,
  onOpenSettings,
  dragAttributes,
  dragListeners,
}: LaneHeaderProps) {
  const t = useTranslations("tasks");
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(laneName);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const updateLane = trpc.taskStatuses.update.useMutation({
    onSuccess: () => {
      onChange();
    },
    onError: (err) => {
      toast.error(err.message || t("laneHeader.updateFailed"));
      setDraftName(laneName);
    },
  });

  // Sync draft when external name changes (e.g. after a refetch)
  useEffect(() => {
    setDraftName(laneName);
  }, [laneName]);

  // Click-outside and Escape close the menu + color popover
  useEffect(() => {
    if (!menuOpen && !colorOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setColorOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setColorOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, colorOpen]);

  const commitRename = () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === laneName) {
      setDraftName(laneName);
      setEditing(false);
      return;
    }
    updateLane.mutate({ id: laneId, name: trimmed });
    setEditing(false);
  };

  const pickColor = (color: string) => {
    setColorOpen(false);
    setMenuOpen(false);
    if (color === laneColor) return;
    updateLane.mutate({ id: laneId, color });
  };

  const closeMenu = () => {
    setMenuOpen(false);
    setColorOpen(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: rollen er dynamisk (button med drag-handle, ellers img), og aria-label er gyldig for begge */}
      <span
        {...(dragAttributes ?? {})}
        {...(dragListeners ?? {})}
        role={dragListeners ? "button" : "img"}
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
          dragListeners ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        style={{ backgroundColor: laneColor }}
        aria-label={
          dragListeners
            ? t("laneHeader.dragReorderLane", { lane: laneName })
            : undefined
        }
        title={dragListeners ? t("laneHeader.dragReorder") : undefined}
      />
      {editing ? (
        <input
          value={draftName}
          maxLength={50}
          aria-label={t("laneHeader.nameLabel")}
          // biome-ignore lint/a11y/noAutofocus: omdøbning startes af brugeren
          autoFocus
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraftName(laneName);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-1.5 py-0.5 text-sm focus:border-brand-500 dark:focus:border-brand-400 focus:outline-none"
        />
      ) : (
        <h3
          className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white"
          onDoubleClick={() => setEditing(true)}
          title={
            laneCategory
              ? t("laneHeader.titleWithCategory", {
                  lane: laneName,
                  category: t(`laneCategoryLower.${laneCategory}`),
                })
              : t("laneHeader.doubleClickRename")
          }
        >
          {laneName}
        </h3>
      )}
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
        <span className="sr-only">{t("laneHeader.taskCount")} </span>
        {taskCount}
      </span>
      {onCollapse && (
        <button
          type="button"
          onClick={onCollapse}
          aria-label={t("laneHeader.collapseLane", { lane: laneName })}
          title={t("laneHeader.collapse")}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
      )}
      <div ref={menuRef} className="relative shrink-0">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => {
            setMenuOpen((v) => !v);
            setColorOpen(false);
          }}
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label={t("laneHeader.settingsFor", { lane: laneName })}
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && !colorOpen && (
          <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <button
              type="button"
              onClick={() => {
                closeMenu();
                setEditing(true);
              }}
              className={MENU_ITEM}
            >
              <Pencil className="h-4 w-4" />
              {t("laneHeader.rename")}
            </button>
            <button
              type="button"
              onClick={() => setColorOpen(true)}
              className={MENU_ITEM}
            >
              <Palette className="h-4 w-4" />
              {t("laneHeader.changeColor")}
            </button>
            {onMove && (
              <>
                <button
                  type="button"
                  disabled={!canMoveLeft}
                  onClick={() => {
                    closeMenu();
                    onMove(laneId, -1);
                  }}
                  className={MENU_ITEM}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("laneHeader.moveLeft")}
                </button>
                <button
                  type="button"
                  disabled={!canMoveRight}
                  onClick={() => {
                    closeMenu();
                    onMove(laneId, 1);
                  }}
                  className={MENU_ITEM}
                >
                  <ArrowRight className="h-4 w-4" />
                  {t("laneHeader.moveRight")}
                </button>
              </>
            )}
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  closeMenu();
                  onOpenSettings();
                }}
                className={MENU_ITEM}
              >
                <Settings2 className="h-4 w-4" />
                {t("laneHeader.customize")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                closeMenu();
                onDeleteRequest(laneId);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-4 w-4" />
              {t("laneHeader.deleteLane")}
            </button>
          </div>
        )}
        {colorOpen && (
          <fieldset className="absolute right-0 top-full z-10 mt-1 grid w-44 grid-cols-5 gap-1.5 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
            <legend className="sr-only">
              {t("laneHeader.colorFor", { lane: laneName })}
            </legend>
            {LANE_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => pickColor(c.value)}
                className={`h-6 w-6 rounded-full border-2 transition ${
                  c.value.toLowerCase() === laneColor.toLowerCase()
                    ? "border-gray-900 dark:border-white"
                    : "border-transparent hover:border-gray-400"
                }`}
                style={{ backgroundColor: c.value }}
                aria-label={t(`laneColors.${c.id}`)}
                aria-pressed={c.value.toLowerCase() === laneColor.toLowerCase()}
                title={t(`laneColors.${c.id}`)}
              />
            ))}
          </fieldset>
        )}
      </div>
    </div>
  );
}
