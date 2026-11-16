"use client";

import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Strikethrough } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef } from "react";

interface TaskNotesProps {
  content: string | null;
  onSave: (content: string) => void;
  debounceMs?: number;
}

export function TaskNotes({
  content,
  onSave,
  debounceMs = 500,
}: TaskNotesProps) {
  const t = useTranslations("tasks");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const parsedContent = useMemo(() => {
    if (!content) return undefined;
    try {
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }, [content]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({
        placeholder: t("notes.placeholder"),
      }),
    ],
    content: parsedContent,
    editorProps: {
      attributes: {
        "aria-label": t("notes.label"),
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onSaveRef.current(JSON.stringify(ed.getJSON()));
      }, debounceMs);
    },
  });

  // Cleanup debounce on unmount — flush pending save first
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        if (editor && !editor.isDestroyed) {
          onSaveRef.current(JSON.stringify(editor.getJSON()));
        }
      }
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/50">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-2 py-1 rounded-t-lg">
        <ToolbarButton
          active={editor.isActive("bold")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBold().run();
          }}
          aria-label={t("notes.bold")}
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleItalic().run();
          }}
          aria-label={t("notes.italic")}
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("strike")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleStrike().run();
          }}
          aria-label={t("notes.strike")}
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>

        {/* Separator */}
        <div className="mx-1 h-4 w-px bg-gray-300 dark:bg-gray-600" />

        <ToolbarButton
          active={editor.isActive("bulletList")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleBulletList().run();
          }}
          aria-label={t("notes.bulletList")}
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onMouseDown={(e) => {
            e.preventDefault();
            editor.chain().focus().toggleOrderedList().run();
          }}
          aria-label={t("notes.orderedList")}
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* Editor */}
      <EditorContent
        editor={editor}
        className="typeset typeset-app max-w-none px-3 py-2 [&_.ProseMirror]:min-h-[80px] [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-gray-400 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]"
      />
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  ...props
}: {
  active: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded p-1.5 transition-colors ${
        active
          ? "bg-gray-200 text-gray-900 dark:bg-gray-600 dark:text-white"
          : "text-gray-500 hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      }`}
      {...props}
    >
      {children}
    </button>
  );
}
