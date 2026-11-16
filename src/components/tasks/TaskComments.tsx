"use client";

// Editor-typen kommer fra @tiptap/core: 3.29 fjernede re-eksporten fra
// @tiptap/react (udgivet i en patch-gruppe, men reelt et brud).
import type { Editor, JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionProps } from "@tiptap/suggestion";
import { Edit3, ImagePlus, MessageSquare, Send, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { toast } from "sonner";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { MentionList } from "@/components/tasks/MentionList";
import { UserAvatar as SharedUserAvatar } from "@/components/ui/UserAvatar";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { compressImage } from "@/lib/upload/compress-image";
import { trpc } from "@/providers/trpc-provider";

// ── Mention suggestion config ──────────────────────────────────────────

interface MentionItem {
  id: string;
  label: string;
}

function createMentionSuggestion(membersRef: React.RefObject<MentionItem[]>) {
  return {
    items: ({ query }: { query: string }) => {
      const members = membersRef.current ?? [];
      if (!query) return members.slice(0, 8);
      const lower = query.toLowerCase();
      return members
        .filter((m) => m.label.toLowerCase().includes(lower))
        .slice(0, 8);
    },
    render: () => {
      let popup: TippyInstance[] | null = null;
      let root: ReactDOM.Root | null = null;
      let el: HTMLElement | null = null;
      const component: {
        ref: React.RefObject<{
          onKeyDown: (props: { event: KeyboardEvent }) => boolean;
        } | null>;
      } = {
        ref: { current: null },
      };

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          el = document.createElement("div");
          root = ReactDOM.createRoot(el);
          root.render(<MentionList {...props} ref={component.ref} />);

          if (!props.clientRect) return;

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => document.body,
            content: el,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        onUpdate: (props: SuggestionProps<MentionItem>) => {
          root?.render(<MentionList {...props} ref={component.ref} />);
          if (popup?.[0] && props.clientRect) {
            popup[0].setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          }
        },
        onKeyDown: (props: { event: KeyboardEvent }) => {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.current?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          root?.unmount();
          root = null;
          popup?.[0]?.destroy();
        },
      };
    },
  };
}

// ── Image upload helper ────────────────────────────────────────────────

type TasksT = ReturnType<typeof useTranslations<"tasks">>;

async function uploadImage(file: File, t: TasksT): Promise<string | null> {
  try {
    const compressed = await compressImage(file, {
      maxWidth: 1920,
      quality: 0.8,
    });
    const formData = new FormData();
    formData.append("file", compressed, file.name);

    const res = await fetch("/api/upload/task-image", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("comments.uploadError"));
    }
    const data = await res.json();
    return data.url;
  } catch (err) {
    toast.error(
      t("comments.uploadFailed", {
        message:
          err instanceof Error ? err.message : t("comments.unknownError"),
      }),
    );
    return null;
  }
}

// ── Relative time helper ───────────────────────────────────────────────

function relativeTime(date: Date | string, t: TasksT, locale: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60) return t("comments.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("comments.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("comments.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("comments.daysAgo", { count: days });

  return d.toLocaleDateString(toIntlLocale(locale), {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

// ── User avatar ────────────────────────────────────────────────────────
// Delt komponent med onError-fallback — se @/components/ui/UserAvatar.
// Lokal wrapper bevarer kommentarernes blå fallback og sm-default.

function UserAvatar({
  name,
  image,
  size = "sm",
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "md";
}) {
  return (
    <SharedUserAvatar
      name={name}
      image={image}
      size={size}
      fallbackClassName="bg-brand-100 text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
    />
  );
}

// ── Comment editor (used for both new and edit) ────────────────────────

function CommentEditor({
  editor,
  onSubmit,
  onCancel,
  submitLabel,
  isSubmitting,
}: {
  editor: Editor | null;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  isSubmitting: boolean;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !editor) return;
      e.target.value = "";

      const url = await uploadImage(file, t);
      if (url) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
    [editor, t],
  );

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <EditorContent
        editor={editor}
        className="comment-editor typeset typeset-app max-w-none px-3 py-2 focus-within:outline-none [&_.ProseMirror]:min-h-[60px] [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0 [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-gray-400 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded-lg [&_.mention]:rounded [&_.mention]:bg-brand-100 [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:text-brand-700 [&_.mention]:dark:bg-brand-900/30 [&_.mention]:dark:text-brand-300"
      />
      <div className="flex flex-wrap items-center justify-between gap-y-1 border-t border-gray-100 px-3 py-1.5 dark:border-gray-700">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleImageUpload}
            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            aria-label={t("comments.addImage")}
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <span className="hidden text-xs text-gray-400 sm:inline">
            {t("comments.ctrlEnter")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-1 text-sm text-gray-500 dark:text-gray-300 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {tc("cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-tt-gran px-3 py-1 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Single comment display ─────────────────────────────────────────────

function CommentItem({
  comment,
  isOwn,
  onEdit,
  onDelete,
}: {
  comment: {
    id: string;
    contentHtml: string;
    createdAt: Date;
    updatedAt: Date;
    user: { id: string; name: string; image: string | null };
  };
  isOwn: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("tasks");
  const locale = useLocale();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wasEdited =
    new Date(comment.updatedAt).getTime() -
      new Date(comment.createdAt).getTime() >
    1000;

  return (
    <div className="group flex gap-3">
      <UserAvatar name={comment.user.name} image={comment.user.image} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-white">
            {comment.user.name}
          </span>
          <span className="text-xs text-gray-400">
            {relativeTime(comment.createdAt, t, locale)}
          </span>
          {wasEdited && (
            <span className="text-xs italic text-gray-400">
              {t("comments.edited")}
            </span>
          )}
          {isOwn && (
            <div className="flex items-center gap-1 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onDelete();
                      setConfirmDelete(false);
                    }}
                    className="text-xs font-medium text-red-600 dark:text-red-400"
                    aria-label={t("comments.confirmDelete")}
                  >
                    {t("comments.deleteQuestion")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-gray-500 dark:text-gray-300"
                    aria-label={t("comments.cancelDelete")}
                  >
                    {t("comments.no")}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={onEdit}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    aria-label={t("comments.editComment")}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    aria-label={t("comments.deleteComment")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div
          className="typeset typeset-app mt-1 max-w-none [&_img]:max-w-full [&_img]:rounded-lg [&_.mention]:rounded [&_.mention]:bg-brand-100 [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:text-brand-700 [&_.mention]:dark:bg-brand-900/30 [&_.mention]:dark:text-brand-300"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by TipTap
          dangerouslySetInnerHTML={{ __html: comment.contentHtml }}
        />
      </div>
    </div>
  );
}

// ── Edit comment editor (only mounted when editing) ───────────────────

function EditCommentEditor({
  initialContent,
  membersRef,
  onSave,
  onCancel,
}: {
  initialContent: JSONContent;
  membersRef: React.RefObject<MentionItem[]>;
  onSave: (content: JSONContent, html: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("tasks");
  const tc = useTranslations("common");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder: t("comments.editPlaceholder") }),
      Image.configure({ inline: false, allowBase64: false }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: createMentionSuggestion(membersRef),
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "typeset typeset-app max-w-none focus:outline-none min-h-[60px] p-3",
        "aria-label": t("comments.editComment"),
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (files?.length) {
          const file = files[0];
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            uploadImage(file, t).then((url) => {
              if (url) {
                const { tr } = view.state;
                const pos = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                })?.pos;
                if (pos !== undefined) {
                  const node = view.state.schema.nodes.image.create({
                    src: url,
                  });
                  view.dispatch(tr.insert(pos, node));
                }
              }
            });
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) {
                uploadImage(file, t).then((url) => {
                  if (url) {
                    const { tr, selection } = view.state;
                    const node = view.state.schema.nodes.image.create({
                      src: url,
                    });
                    view.dispatch(tr.insert(selection.from, node));
                  }
                });
              }
              return true;
            }
          }
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          onCancel();
          return true;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          if (editor) onSave(editor.getJSON(), editor.getHTML());
          return true;
        }
        return false;
      },
    },
  });

  if (!editor) return null;

  return (
    <CommentEditor
      editor={editor}
      onSubmit={() => onSave(editor.getJSON(), editor.getHTML())}
      onCancel={onCancel}
      submitLabel={tc("save")}
      isSubmitting={false}
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function TaskComments({ taskId }: { taskId: string }) {
  const t = useTranslations("tasks");
  const { data: session } = useSession();
  const utils = trpc.useUtils();

  const [editingId, setEditingId] = useState<string | null>(null);

  // Load org members for @mentions
  const { data: orgMembers } = trpc.organization.getMembers.useQuery(
    undefined,
    { retry: false },
  );
  const membersRef = useRef<MentionItem[]>([]);
  useEffect(() => {
    membersRef.current = (orgMembers ?? []).map((m) => ({
      id: m.userId,
      label: m.name,
    }));
  }, [orgMembers]);

  // Comments query — no polling; mutations invalidate on success
  const { data: comments = [] } = trpc.taskComments.list.useQuery({ taskId });

  const createMutation = trpc.taskComments.create.useMutation({
    onSuccess: () => {
      utils.taskComments.list.invalidate({ taskId });
      newEditor?.commands.clearContent();
    },
    onError: (err) => {
      toast.error(t("comments.createFailed"), {
        description: err.message,
      });
    },
  });

  const updateMutation = trpc.taskComments.update.useMutation({
    onSuccess: () => {
      utils.taskComments.list.invalidate({ taskId });
      setEditingId(null);
    },
    onError: (err) => {
      toast.error(t("comments.updateFailed"), {
        description: err.message,
      });
    },
  });

  const deleteMutation = trpc.taskComments.delete.useMutation({
    onSuccess: () => {
      utils.taskComments.list.invalidate({ taskId });
      toast.success(t("comments.deleted"));
    },
    onError: (err) => {
      toast.error(t("comments.deleteFailed"), {
        description: err.message,
      });
    },
  });

  // ── New comment editor ─────────────────────────────────────────────

  const newEditor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: t("comments.newPlaceholder"),
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      Mention.configure({
        HTMLAttributes: { class: "mention" },
        suggestion: createMentionSuggestion(membersRef),
      }),
    ],
    editorProps: {
      attributes: {
        "aria-label": t("comments.newLabel"),
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (files?.length) {
          const file = files[0];
          if (file.type.startsWith("image/")) {
            event.preventDefault();
            uploadImage(file, t).then((url) => {
              if (url) {
                const { tr } = view.state;
                const pos = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                })?.pos;
                if (pos !== undefined) {
                  const node = view.state.schema.nodes.image.create({
                    src: url,
                  });
                  view.dispatch(tr.insert(pos, node));
                }
              }
            });
            return true;
          }
        }
        return false;
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith("image/")) {
              event.preventDefault();
              const file = item.getAsFile();
              if (file) {
                uploadImage(file, t).then((url) => {
                  if (url) {
                    const { tr, selection } = view.state;
                    const node = view.state.schema.nodes.image.create({
                      src: url,
                    });
                    view.dispatch(tr.insert(selection.from, node));
                  }
                });
              }
              return true;
            }
          }
        }
        return false;
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          handleCreate();
          return true;
        }
        return false;
      },
    },
  });

  const handleCreate = useCallback(() => {
    if (!newEditor) return;
    const html = newEditor.getHTML();
    const json = newEditor.getJSON();
    // Check if editor is empty
    const textContent = newEditor.state.doc.textContent.trim();
    const hasImages = html.includes("<img");
    if (!textContent && !hasImages) return;

    createMutation.mutate({
      taskId,
      content: json,
      contentHtml: html,
    });
  }, [newEditor, taskId, createMutation]);

  // ── Edit handler ────────────────────────────────────────────────────

  const handleUpdate = useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: TipTap content JSON is untyped
    (commentId: string, content: any, contentHtml: string) => {
      updateMutation.mutate({
        id: commentId,
        content,
        contentHtml,
      });
    },
    [updateMutation],
  );

  const handleDelete = useCallback(
    (commentId: string) => {
      deleteMutation.mutate({ id: commentId });
    },
    [deleteMutation],
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:shadow-none dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <MessageSquare className="h-5 w-5" />
        {t("comments.title")}
        {comments.length > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
            {comments.length}
          </span>
        )}
      </h2>

      {/* Comment thread */}
      {comments.length > 0 && (
        <div className="mb-6 space-y-4">
          {comments.map((comment) => {
            const isOwn = comment.user.id === session?.user?.id;

            if (editingId === comment.id) {
              return (
                <div key={comment.id} className="flex gap-3">
                  <UserAvatar
                    name={comment.user.name}
                    image={comment.user.image}
                  />
                  <div className="min-w-0 flex-1">
                    <EditCommentEditor
                      key={comment.id}
                      initialContent={comment.content as JSONContent}
                      membersRef={membersRef}
                      onSave={(content, html) => {
                        handleUpdate(comment.id, content, html);
                        setEditingId(null);
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                </div>
              );
            }

            return (
              <CommentItem
                key={comment.id}
                comment={comment}
                isOwn={isOwn}
                onEdit={() => setEditingId(comment.id)}
                onDelete={() => handleDelete(comment.id)}
              />
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {comments.length === 0 && (
        <div className="mb-6 py-4 text-center text-sm text-gray-400">
          {t("comments.empty")}
        </div>
      )}

      {/* New comment editor */}
      <CommentEditor
        editor={newEditor}
        onSubmit={handleCreate}
        submitLabel={t("comments.send")}
        isSubmitting={createMutation.isPending}
      />
    </div>
  );
}
