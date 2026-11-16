"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";
import { TagChip } from "./TagChip";

const TAG_COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

interface TagPickerProps {
  selectedTagIds: string[];
  inheritedTags?: Array<{ id: string; name: string; color: string }>;
  onChange: (tagIds: string[]) => void;
  placeholder?: string;
}

export function TagPicker({
  selectedTagIds,
  inheritedTags = [],
  onChange,
  placeholder,
}: TagPickerProps) {
  const t = useTranslations("tags");
  const placeholderText = placeholder ?? t("placeholder");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const { data: allTags } = trpc.tags.list.useQuery();

  const createTag = trpc.tags.create.useMutation({
    onSuccess: (newTag) => {
      if (!newTag) return;
      toast.success(t("created", { name: newTag.name }));
      utils.tags.list.invalidate();
      onChange([...selectedTagIds, newTag.id]);
      setSearch("");
    },
    onError: (err) => toast.error(err.message),
  });

  const selectedTags = (allTags ?? []).filter((tag) =>
    selectedTagIds.includes(tag.id),
  );

  const searchLower = search.toLowerCase();
  const filteredTags = (allTags ?? []).filter(
    (tag) =>
      !selectedTagIds.includes(tag.id) &&
      tag.name.toLowerCase().includes(searchLower),
  );

  const exactMatch = (allTags ?? []).some(
    (tag) => tag.name.toLowerCase() === searchLower,
  );
  const canCreate = search.trim().length > 0 && !exactMatch;

  const handleSelect = (tagId: string) => {
    onChange([...selectedTagIds, tagId]);
    setSearch("");
    inputRef.current?.focus();
  };

  const handleRemove = (tagId: string) => {
    onChange(selectedTagIds.filter((id) => id !== tagId));
  };

  const handleCreate = () => {
    if (!canCreate || createTag.isPending) return;
    const randomColor =
      TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
    createTag.mutate({ name: search.trim(), color: randomColor });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredTags.length > 0) {
        handleSelect(filteredTags[0].id);
      } else if (canCreate) {
        handleCreate();
      }
    } else if (
      e.key === "Backspace" &&
      search === "" &&
      selectedTagIds.length > 0
    ) {
      handleRemove(selectedTagIds[selectedTagIds.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="flex min-h-[42px] w-full flex-wrap items-center gap-1.5 rounded-md border border-gray-300 bg-white p-2 text-left dark:border-gray-600 dark:bg-gray-800"
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {inheritedTags.map((t) => (
          <TagChip
            key={`inh-${t.id}`}
            name={t.name}
            color={t.color}
            inherited
          />
        ))}
        {selectedTags.map((t) => (
          <TagChip
            key={t.id}
            name={t.name}
            color={t.color}
            onRemove={() => handleRemove(t.id)}
          />
        ))}
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKeyDown}
          placeholder={
            selectedTags.length === 0 && inheritedTags.length === 0
              ? placeholderText
              : ""
          }
          className="min-w-[80px] flex-1 bg-transparent text-sm outline-none"
        />
      </button>

      {open && (filteredTags.length > 0 || canCreate) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {filteredTags.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(t.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: t.color }}
              />
              <span>{t.name}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCreate}
              disabled={createTag.isPending}
              className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-2 text-left text-sm text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:hover:bg-tt-gran-lys"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("create", { name: search.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
