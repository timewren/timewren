"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  LANE_CATEGORIES,
  LANE_CATEGORY_LABELS,
  type LaneCategory,
  moveItem,
} from "@/lib/kanban/lane-category";
import { trpc } from "@/providers/trpc-provider";
import { LANE_COLORS, laneColorName } from "./lane-colors";

export interface LaneSetting {
  id: string;
  name: string;
  color: string;
  category: LaneCategory;
}

interface LaneSettingsDialogProps {
  lanes: LaneSetting[];
  taskCounts: Record<string, number>;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
  onAddRequest: () => void;
  onDeleteRequest: (laneId: string) => void;
}

/**
 * "Tilpas kolonner": omdøb, farv, sortér og slet tavlens kolonner, og vælg
 * hvad hver kolonne tæller som. Ændringer gemmes med det samme (som resten
 * af indstillingerne); op/ned-knapperne er tastaturvejen til rækkefølgen.
 */
export function LaneSettingsDialog({
  lanes,
  taskCounts,
  isOpen,
  onClose,
  onChanged,
  onAddRequest,
  onDeleteRequest,
}: LaneSettingsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen);
  const [colorFor, setColorFor] = useState<string | null>(null);
  // Fokus bliver på samme knap, når rækken er flyttet (efter refetch).
  const [refocus, setRefocus] = useState<{
    laneId: string;
    button: "up" | "down";
    index: number;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (colorFor) {
        setColorFor(null);
        return;
      }
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, colorFor]);

  useEffect(() => {
    if (!refocus) return;
    if (lanes[refocus.index]?.id !== refocus.laneId) return;
    const root = dialogRef.current;
    const wanted = root?.querySelector<HTMLElement>(
      `[data-refocus="${refocus.laneId}:${refocus.button}"]:not([disabled])`,
    );
    (
      wanted ??
      root?.querySelector<HTMLElement>(
        `[data-refocus^="${refocus.laneId}:"]:not([disabled])`,
      )
    )?.focus();
    setRefocus(null);
  }, [lanes, refocus]);

  const update = trpc.taskStatuses.update.useMutation({
    onSuccess: () => onChanged(),
    onError: (err) => {
      toast.error(err.message || "Kunne ikke gemme kolonnen");
      onChanged();
    },
  });
  const reorder = trpc.taskStatuses.reorder.useMutation({
    onSuccess: () => onChanged(),
    onError: (err) => {
      toast.error(err.message || "Kunne ikke flytte kolonnen");
      onChanged();
    },
  });

  if (!isOpen) return null;

  const move = (index: number, delta: -1 | 1) => {
    const lane = lanes[index];
    const next = moveItem(lanes, index, delta);
    reorder.mutate({ orderedIds: next.map((l) => l.id) });
    setRefocus({
      laneId: lane.id,
      button: delta === -1 ? "up" : "down",
      index: index + delta,
    });
    setAnnouncement(
      `${lane.name} er flyttet til plads ${index + delta + 1} af ${lanes.length}`,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lane-settings-title"
        aria-describedby="lane-settings-desc"
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-800"
      >
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h2
              id="lane-settings-title"
              className="text-base font-semibold text-gray-900 dark:text-white"
            >
              Tilpas kolonner
            </h2>
            <p
              id="lane-settings-desc"
              className="mt-0.5 text-xs text-gray-500 dark:text-gray-400"
            >
              Kolonnerne deles af alle i arbejdsområdet. "Tæller som" bestemmer,
              om opgaverne er ikke startet, i gang, afsluttet eller annulleret i
              rapporter og filtre.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Luk"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <ol className="flex-1 space-y-2 overflow-y-auto p-4">
          {lanes.map((lane, index) => (
            <li
              key={lane.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700"
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setColorFor((v) => (v === lane.id ? null : lane.id))
                  }
                  aria-label={`Farve for ${lane.name}: ${laneColorName(lane.color)}`}
                  aria-expanded={colorFor === lane.id}
                  className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <span
                    className="h-4 w-4 rounded-full"
                    style={{ backgroundColor: lane.color }}
                  />
                </button>
                {colorFor === lane.id && (
                  <fieldset className="absolute left-0 top-full z-10 mt-1 grid w-44 grid-cols-5 gap-1.5 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    <legend className="sr-only">Farve for {lane.name}</legend>
                    {LANE_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        aria-label={c.name}
                        title={c.name}
                        aria-pressed={
                          c.value.toLowerCase() === lane.color.toLowerCase()
                        }
                        onClick={() => {
                          setColorFor(null);
                          if (c.value !== lane.color) {
                            update.mutate({ id: lane.id, color: c.value });
                          }
                        }}
                        className={`h-6 w-6 rounded-full border-2 ${
                          c.value.toLowerCase() === lane.color.toLowerCase()
                            ? "border-gray-900 dark:border-white"
                            : "border-transparent hover:border-gray-400"
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </fieldset>
                )}
              </div>

              <LaneNameInput
                key={`${lane.id}:${lane.name}`}
                lane={lane}
                position={index + 1}
                onSave={(name) => update.mutate({ id: lane.id, name })}
              />

              <select
                value={lane.category}
                aria-label={`${lane.name} tæller som`}
                onChange={(e) => {
                  const category = e.target.value as LaneCategory;
                  update.mutate(
                    { id: lane.id, category },
                    {
                      onSuccess: () => {
                        const count = taskCounts[lane.id] ?? 0;
                        if (count > 0) {
                          toast.success(
                            `${count} ${count === 1 ? "opgave" : "opgaver"} i ${lane.name} tæller nu som ${LANE_CATEGORY_LABELS[category].toLowerCase()}`,
                          );
                        }
                      },
                    },
                  );
                }}
                className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                {LANE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {LANE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>

              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  data-refocus={`${lane.id}:up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                  aria-label={`Flyt ${lane.name} op`}
                  title="Flyt op"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-refocus={`${lane.id}:down`}
                  disabled={index === lanes.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                  aria-label={`Flyt ${lane.name} ned`}
                  title="Flyt ned"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={lanes.length <= 1}
                  onClick={() => onDeleteRequest(lane.id)}
                  aria-label={`Slet ${lane.name}`}
                  title={
                    lanes.length <= 1
                      ? "Tavlen skal have mindst én kolonne"
                      : "Slet kolonne"
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={onAddRequest}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Plus className="h-4 w-4" />
            Tilføj kolonne
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            Færdig
          </button>
        </div>
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    </div>
  );
}

function LaneNameInput({
  lane,
  position,
  onSave,
}: {
  lane: LaneSetting;
  position: number;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(lane.name);
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(lane.name);
      return;
    }
    if (trimmed !== lane.name) onSave(trimmed);
  };
  return (
    <input
      value={draft}
      maxLength={50}
      aria-label={`Navn på kolonne ${position}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      className="h-8 min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
    />
  );
}
