"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

interface InlineEditProps {
  value: string;
  onSave: (value: string) => void;
  as?: "input" | "textarea";
  placeholder?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
}

export function InlineEdit({
  value,
  onSave,
  as = "input",
  placeholder,
  className = "",
  displayClassName = "",
  inputClassName = "",
}: InlineEditProps) {
  const t = useTranslations("tasks");
  const placeholderText = placeholder ?? t("inlineEdit.placeholder");
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when value changes externally
  useEffect(() => {
    if (!isEditing) {
      setDraft(value);
    }
  }, [value, isEditing]);

  const startEditing = useCallback(() => {
    setDraft(value);
    setIsEditing(true);
  }, [value]);

  const save = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setIsEditing(false);
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setIsEditing(false);
  }, [value]);

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing) {
      const el = as === "textarea" ? textareaRef.current : inputRef.current;
      if (el) {
        el.focus();
        // Place cursor at end
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    }
  }, [isEditing, as]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
      // For input, Enter saves. For textarea, Enter inserts newline (Ctrl+Enter could save if needed).
      if (e.key === "Enter" && as === "input") {
        e.preventDefault();
        save();
      }
    },
    [as, save, cancel],
  );

  if (isEditing) {
    const sharedClasses = `
      w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm
      text-gray-900 placeholder-gray-400
      focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20
      dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500
      dark:focus:border-brand-500
      ${inputClassName}
    `.trim();

    if (as === "textarea") {
      return (
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          rows={3}
          className={`${sharedClasses} resize-y ${className}`}
        />
      );
    }

    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        placeholder={placeholderText}
        className={`${sharedClasses} ${className}`}
      />
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: indholdet er blokelementer (div'er), som ikke må ligge i en button
    <div
      role="button"
      tabIndex={0}
      onClick={startEditing}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          startEditing();
        }
      }}
      className={`
        cursor-text rounded-md border border-transparent px-2 py-1 text-sm
        transition-colors duration-150
        hover:border-gray-300 dark:hover:border-gray-600
        focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500
        dark:focus:border-brand-500
        ${className}
        ${displayClassName}
      `.trim()}
    >
      {value ? (
        <span className="text-gray-900 dark:text-gray-100">{value}</span>
      ) : (
        <span className="italic text-gray-400 dark:text-gray-500">
          {placeholderText}
        </span>
      )}
    </div>
  );
}
