"use client";

import { Check, ChevronsUpDown, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUiScope } from "./use-ui-text";

interface Member {
  userId: string;
  name: string;
  image?: string | null;
}

interface Props {
  members: Member[] | undefined;
  values: string[];
  onValuesChange: (ids: string[]) => void;
  id?: string;
  placeholder?: string;
  /** Tekst på "ryd valget"-punktet øverst (default: "Alle medarbejdere" i aktivt sprog). */
  clearLabel?: string;
}

/**
 * Compact multi-select for filtering by organization member. Teams have few
 * members, so a plain checkbox list (no search) is enough.
 */
export function MemberMultiSelect({
  members,
  values,
  onValuesChange,
  id,
  placeholder,
  clearLabel,
}: Props) {
  const t = useUiScope("member");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const list = members ?? [];
  const selected = list.filter((m) => values.includes(m.userId));
  const triggerLabel =
    selected.length === 0
      ? (placeholder ?? t("all"))
      : selected.length === 1
        ? selected[0].name
        : t("selected", { count: selected.length });

  const toggle = (userId: string) => {
    onValuesChange(
      values.includes(userId)
        ? values.filter((v) => v !== userId)
        : [...values, userId],
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      >
        <span
          className={selected.length ? "" : "text-gray-500 dark:text-gray-400"}
        >
          {triggerLabel}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-48 rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800">
          <div
            role="listbox"
            aria-multiselectable
            className="max-h-60 overflow-y-auto p-1"
          >
            <button
              type="button"
              onClick={() => onValuesChange([])}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-gray-500 hover:bg-brand-50 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <span>{clearLabel ?? t("all")}</span>
              {values.length === 0 && (
                <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              )}
            </button>
            {list.map((m) => (
              <button
                key={m.userId}
                type="button"
                role="option"
                aria-selected={values.includes(m.userId)}
                onClick={() => toggle(m.userId)}
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-gray-900 hover:bg-brand-50 dark:text-white dark:hover:bg-gray-700"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-gray-400" />
                  {m.name}
                </span>
                {values.includes(m.userId) && (
                  <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
