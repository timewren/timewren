"use client";

import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

export interface RecentEntrySelection {
  entryId: string;
  projectId: string | null;
  clientId: string | null;
  description: string;
  projectName: string | null;
  clientName: string | null;
  hours: string;
}

interface DescriptionAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelectEntry: (entry: RecentEntrySelection) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function DescriptionAutocomplete({
  value,
  onChange,
  onSelectEntry,
  placeholder,
  className = "",
  disabled = false,
}: DescriptionAutocompleteProps) {
  const t = useTranslations("timer");
  const locale = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);

  const { data: recentTasks } = trpc.time.getRecent.useQuery({ limit: 10 });

  // Filter entries based on current input
  const filteredEntries = recentTasks?.filter((task) => {
    if (!value.trim()) return true;
    const search = value.toLowerCase();
    return (
      task.description.toLowerCase().includes(search) ||
      task.projectName?.toLowerCase().includes(search) ||
      task.clientName?.toLowerCase().includes(search)
    );
  });

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || !filteredEntries?.length) {
      if (e.key === "ArrowDown" && filteredEntries?.length) {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < filteredEntries.length - 1 ? prev + 1 : 0,
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev > 0 ? prev - 1 : filteredEntries.length - 1,
        );
        break;
      case "Enter":
        if (activeIndex >= 0 && filteredEntries[activeIndex]) {
          e.preventDefault();
          handleSelect(filteredEntries[activeIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const handleSelect = (task: RecentEntrySelection) => {
    onSelectEntry(task);
    setIsOpen(false);
    setActiveIndex(-1);
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listboxRef.current) {
      const activeItem = listboxRef.current.children[
        activeIndex
      ] as HTMLElement;
      activeItem?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const formatHours = (hours: string) => {
    const h = parseFloat(hours);
    return h.toLocaleString(toIntlLocale(locale), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="description-autocomplete-list"
        aria-activedescendant={
          activeIndex >= 0 ? `autocomplete-option-${activeIndex}` : undefined
        }
        aria-autocomplete="list"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActiveIndex(-1);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? t("autocomplete.placeholder")}
        disabled={disabled}
        className={className}
      />
      {isOpen && !disabled && filteredEntries && filteredEntries.length > 0 && (
        <div
          ref={listboxRef}
          id="description-autocomplete-list"
          role="listbox"
          aria-label={t("autocomplete.recentTasks")}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg"
        >
          {filteredEntries.map((task, index) => (
            <div
              key={task.entryId}
              id={`autocomplete-option-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(task);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                index === activeIndex
                  ? "bg-brand-50 dark:bg-tt-gran-lys"
                  : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
              }`}
            >
              <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-gray-900 dark:text-white">
                  {task.description || t("autocomplete.noDescription")}
                </div>
                {(task.clientName || task.projectName) && (
                  <div className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {[task.clientName, task.projectName]
                      .filter(Boolean)
                      .join(" → ")}
                  </div>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-300">
                {t("autocomplete.hoursShort", {
                  hours: formatHours(task.hours),
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
