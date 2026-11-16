"use client";

import {
  AlertTriangle,
  Calendar,
  Clock,
  FileText,
  FolderKanban,
  Plus,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

interface UserDataProps {
  userId: string;
  activeTab: string;
}

export function UserData({ userId, activeTab }: UserDataProps) {
  const t = useTranslations("adminUsers");
  const locale = useLocale();
  const intlLocale = toIntlLocale(locale);
  const [newNote, setNewNote] = useState("");
  const [noteImportant, setNoteImportant] = useState(false);

  const { data: clients } = trpc.admin.getUserClients.useQuery(
    { userId, limit: 20 },
    { enabled: activeTab === "clients" },
  );
  const { data: projects } = trpc.admin.getUserProjects.useQuery(
    { userId, limit: 20 },
    { enabled: activeTab === "projects" },
  );
  const { data: timeEntries } = trpc.admin.getUserTimeEntries.useQuery(
    { userId, limit: 20 },
    { enabled: activeTab === "time" },
  );
  const { data: invoices } = trpc.admin.getUserInvoices.useQuery(
    { userId, limit: 20 },
    { enabled: activeTab === "invoices" },
  );
  const { data: notes, refetch: refetchNotes } =
    trpc.admin.getUserNotes.useQuery(
      { userId, limit: 50 },
      { enabled: activeTab === "notes" },
    );

  const addNoteMutation = trpc.admin.addUserNote.useMutation({
    onSuccess: () => {
      toast.success(t("data.noteAdded"));
      refetchNotes();
      setNewNote("");
      setNoteImportant(false);
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteNoteMutation = trpc.admin.deleteUserNote.useMutation({
    onSuccess: () => {
      toast.success(t("data.noteDeleted"));
      refetchNotes();
    },
    onError: (error) => toast.error(error.message),
  });

  if (activeTab === "clients") {
    return (
      <div className="divide-y divide-gray-200">
        {clients?.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Users className="mx-auto h-10 w-10 mb-2 opacity-50" />
            <p>{t("data.noClients")}</p>
          </div>
        ) : (
          clients?.map((client) => (
            <div
              key={client.id}
              className="p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">{client.name}</p>
                {client.company && (
                  <p className="text-sm text-gray-500">{client.company}</p>
                )}
              </div>
              <div>
                {client.isArchived ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {t("data.archived")}
                  </span>
                ) : client.isActive ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                    {t("data.active")}
                  </span>
                ) : (
                  <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-700">
                    {t("data.inactive")}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeTab === "projects") {
    return (
      <div className="divide-y divide-gray-200">
        {projects?.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FolderKanban className="mx-auto h-10 w-10 mb-2 opacity-50" />
            <p>{t("data.noProjects")}</p>
          </div>
        ) : (
          projects?.map((project) => (
            <div
              key={project.id}
              className="p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">{project.name}</p>
                <p className="text-sm text-gray-500">
                  {Array.isArray(project.client)
                    ? project.client[0]?.name
                    : project.client?.name}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  project.status === "active"
                    ? "bg-green-100 text-green-700"
                    : project.status === "completed"
                      ? "bg-brand-100 text-brand-700"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {project.status}
              </span>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeTab === "time") {
    return (
      <div className="divide-y divide-gray-200">
        {timeEntries?.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Clock className="mx-auto h-10 w-10 mb-2 opacity-50" />
            <p>{t("data.noTimeEntries")}</p>
          </div>
        ) : (
          timeEntries?.map((entry) => (
            <div
              key={entry.id}
              className="p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">
                  {entry.description || t("data.noDescription")}
                </p>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Calendar className="h-3.5 w-3.5" />
                  {new Date(entry.date).toLocaleDateString(intlLocale)}
                  {entry.project && (
                    <>
                      <span className="text-gray-300">|</span>
                      {Array.isArray(entry.project)
                        ? entry.project[0]?.name
                        : entry.project.name}
                    </>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-900">
                  {t("data.hours", {
                    hours: parseFloat(entry.hours ?? "0").toFixed(1),
                  })}
                </p>
                <div className="flex items-center gap-1 justify-end">
                  {entry.isBillable && (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                      {t("data.billable")}
                    </span>
                  )}
                  {entry.isBilled && (
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                      {t("data.billed")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeTab === "invoices") {
    return (
      <div className="divide-y divide-gray-200">
        {invoices?.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FileText className="mx-auto h-10 w-10 mb-2 opacity-50" />
            <p>{t("data.noInvoices")}</p>
          </div>
        ) : (
          invoices?.map((invoice) => (
            <div
              key={invoice.id}
              className="p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">
                  {t("data.invoiceNumber", { number: invoice.invoiceNumber })}
                </p>
                <p className="text-sm text-gray-500">
                  {Array.isArray(invoice.client)
                    ? invoice.client[0]?.name
                    : invoice.client?.name}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium text-gray-900">
                  {t("data.amount", {
                    amount: parseFloat(invoice.amount ?? "0").toLocaleString(
                      intlLocale,
                    ),
                  })}
                </p>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    invoice.status === "paid"
                      ? "bg-green-100 text-green-700"
                      : invoice.status === "sent"
                        ? "bg-brand-100 text-brand-700"
                        : invoice.status === "overdue"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {invoice.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeTab === "notes") {
    return (
      <div>
        <div className="border-b border-gray-200 p-4">
          <div className="flex gap-3">
            <textarea
              placeholder={t("data.notePlaceholder")}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm resize-none"
            />
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={noteImportant}
                  onChange={(e) => setNoteImportant(e.target.checked)}
                  className="rounded"
                />
                {t("data.important")}
              </label>
              <button
                type="button"
                onClick={() =>
                  addNoteMutation.mutate({
                    userId,
                    content: newNote,
                    isImportant: noteImportant,
                  })
                }
                disabled={!newNote.trim() || addNoteMutation.isPending}
                className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> {t("data.add")}
              </button>
            </div>
          </div>
        </div>
        <div className="divide-y divide-gray-200">
          {notes?.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <StickyNote className="mx-auto h-10 w-10 mb-2 opacity-50" />
              <p>{t("data.noNotes")}</p>
            </div>
          ) : (
            notes?.map((note) => (
              <div
                key={note.id}
                className={`p-4 ${note.isImportant ? "bg-amber-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    {note.isImportant && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 mb-1">
                        <AlertTriangle className="h-3 w-3" />{" "}
                        {t("data.important")}
                      </span>
                    )}
                    <p className="text-gray-900 whitespace-pre-wrap">
                      {note.content}
                    </p>
                    <p className="mt-2 text-xs text-gray-500">
                      {note.author?.name ?? t("data.unknown")} -{" "}
                      {new Date(note.createdAt).toLocaleString(intlLocale)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      deleteNoteMutation.mutate({ noteId: note.id })
                    }
                    disabled={deleteNoteMutation.isPending}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return null;
}
