"use client";

import type { SuggestionProps } from "@tiptap/suggestion";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

interface MentionItem {
  id: string;
  label: string;
}

export const MentionList = forwardRef<
  { onKeyDown: (props: { event: KeyboardEvent }) => boolean },
  SuggestionProps<MentionItem>
>((props, ref) => {
  const t = useTranslations("tasks");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when items change
  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === "ArrowUp") {
        setSelectedIndex(
          (i) => (i + props.items.length - 1) % props.items.length,
        );
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % props.items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = props.items[selectedIndex];
        if (item) props.command(item);
        return true;
      }
      return false;
    },
  }));

  if (!props.items.length) return null;

  return (
    <div
      role="listbox"
      aria-label={t("mentionList.label")}
      className="z-50 max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:shadow-none dark:ring-1 dark:ring-gray-700 dark:border-gray-700 dark:bg-gray-800"
    >
      {props.items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          onClick={() => props.command(item)}
          className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm ${
            index === selectedIndex
              ? "bg-brand-50 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
              : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
});

MentionList.displayName = "MentionList";
