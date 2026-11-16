"use client";

import { ArrowLeft, Edit2, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/providers/trpc-provider";

function extractVariables(body: string): string[] {
  const matches = body.match(/\{(\w+)\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}

type TemplateForm = {
  name: string;
  subject: string;
  body: string;
  scope: "system" | "personal";
};

const emptyForm: TemplateForm = {
  name: "",
  subject: "",
  body: "",
  scope: "personal",
};

export default function AdminSupportTemplatesPage() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as Record<string, unknown>)?.role === "admin";
  const utils = trpc.useUtils();

  const { data: templates, isLoading } =
    trpc.admin.supportTemplates.listTemplates.useQuery();

  const createMutation = trpc.admin.supportTemplates.createTemplate.useMutation(
    {
      onSuccess: () => {
        utils.admin.supportTemplates.listTemplates.invalidate();
        setModalOpen(false);
        setForm(emptyForm);
        toast.success("Skabelon oprettet");
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const updateMutation = trpc.admin.supportTemplates.updateTemplate.useMutation(
    {
      onSuccess: () => {
        utils.admin.supportTemplates.listTemplates.invalidate();
        setModalOpen(false);
        setEditingId(null);
        setForm(emptyForm);
        toast.success("Skabelon opdateret");
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const deleteMutation = trpc.admin.supportTemplates.deleteTemplate.useMutation(
    {
      onSuccess: () => {
        utils.admin.supportTemplates.listTemplates.invalidate();
        toast.success("Skabelon slettet");
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateForm>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const systemTemplates = templates?.filter((t) => t.scope === "system") ?? [];
  const personalTemplates =
    templates?.filter((t) => t.scope === "personal") ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (t: NonNullable<typeof templates>[number]) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      subject: t.subject ?? "",
      body: t.body,
      scope: t.scope as "system" | "personal",
    });
    setModalOpen(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast.error("Navn og brødtekst er påkrævet");
      return;
    }
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        name: form.name,
        subject: form.subject || undefined,
        body: form.body,
        scope: form.scope,
      });
    } else {
      createMutation.mutate({
        name: form.name,
        subject: form.subject || undefined,
        body: form.body,
        scope: form.scope,
      });
    }
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;
  const bodyVariables = extractVariables(form.body);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/admin/support"
            className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Tilbage til support
          </Link>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Svar-skabeloner
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Opret og administrer skabeloner til hurtige support-svar
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
        >
          <Plus className="h-4 w-4" />
          Ny skabelon
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-8">
          {/* System templates */}
          <TemplateSection
            title="System"
            description="Fælles skabeloner tilgængelige for alle supporters"
            templates={systemTemplates}
            canEdit={isAdmin}
            onEdit={openEdit}
            onDelete={(id) => setDeleteConfirmId(id)}
            deleteConfirmId={deleteConfirmId}
            onDeleteConfirm={(id) => {
              deleteMutation.mutate({ id });
              setDeleteConfirmId(null);
            }}
            onDeleteCancel={() => setDeleteConfirmId(null)}
          />

          {/* Personal templates */}
          <TemplateSection
            title="Mine"
            description="Dine personlige skabeloner"
            templates={personalTemplates}
            canEdit={true}
            onEdit={openEdit}
            onDelete={(id) => setDeleteConfirmId(id)}
            deleteConfirmId={deleteConfirmId}
            onDeleteConfirm={(id) => {
              deleteMutation.mutate({ id });
              setDeleteConfirmId(null);
            }}
            onDeleteCancel={() => setDeleteConfirmId(null)}
          />

          {systemTemplates.length === 0 && personalTemplates.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Ingen skabeloner endnu. Klik &quot;Ny skabelon&quot; for at
                oprette den første.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {editingId ? "Rediger skabelon" : "Ny skabelon"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="tpl-name"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Navn
                </label>
                <input
                  id="tpl-name"
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="F.eks. Velkomst-svar"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              <div>
                <label
                  htmlFor="tpl-subject"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Emne (valgfrit)
                </label>
                <input
                  id="tpl-subject"
                  type="text"
                  value={form.subject}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, subject: e.target.value }))
                  }
                  placeholder="Emne til svar-email"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              <div>
                <label
                  htmlFor="tpl-body"
                  className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  Brødtekst
                </label>
                <textarea
                  id="tpl-body"
                  value={form.body}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, body: e.target.value }))
                  }
                  rows={6}
                  placeholder="Hej {name},&#10;&#10;Tak for din henvendelse..."
                  className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                {bodyVariables.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {bodyVariables.map((v) => (
                      <span
                        key={v}
                        className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
                      >
                        {`{${v}}`}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {isAdmin && (
                <div>
                  <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Type
                  </span>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="radio"
                        name="scope"
                        checked={form.scope === "personal"}
                        onChange={() =>
                          setForm((f) => ({ ...f, scope: "personal" }))
                        }
                        className="text-brand-600 dark:text-brand-400"
                      />
                      Personlig
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="radio"
                        name="scope"
                        checked={form.scope === "system"}
                        onChange={() =>
                          setForm((f) => ({ ...f, scope: "system" }))
                        }
                        className="text-brand-600 dark:text-brand-400"
                      />
                      System (alle supporters)
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Annuller
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isMutating}
                className="flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
              >
                {isMutating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {editingId ? "Gem ændringer" : "Opret"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type TemplateRecord = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  variables: unknown;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
};

function getVariablesArray(variables: unknown): string[] {
  if (Array.isArray(variables)) return variables as string[];
  return [];
}

function TemplateSection({
  title,
  description,
  templates,
  canEdit,
  onEdit,
  onDelete,
  deleteConfirmId,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  title: string;
  description: string;
  templates: TemplateRecord[];
  canEdit: boolean;
  onEdit: (t: TemplateRecord) => void;
  onDelete: (id: string) => void;
  deleteConfirmId: string | null;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  if (templates.length === 0) return null;

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
        {description}
      </p>
      <div className="space-y-2">
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex items-start justify-between rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {t.name}
              </p>
              {t.subject && (
                <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                  Emne: {t.subject}
                </p>
              )}
              <p className="mt-1 line-clamp-2 text-sm text-gray-500 dark:text-gray-400">
                {t.body}
              </p>
              {getVariablesArray(t.variables).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {getVariablesArray(t.variables).map((v) => (
                    <span
                      key={v}
                      className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
                    >
                      {`{${v}}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {canEdit && (
              <div className="ml-4 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(t)}
                  className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  title="Rediger"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                {deleteConfirmId === t.id ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onDeleteConfirm(t.id)}
                      className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      Slet
                    </button>
                    <button
                      type="button"
                      onClick={onDeleteCancel}
                      className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                      Annuller
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDelete(t.id)}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    title="Slet"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
