"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Hammer,
  Lightbulb,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui";
import { trpc } from "@/providers/trpc-provider";

type Status = "planned" | "in-progress" | "completed";
type Category = "Feature" | "Improvement" | "Bug Fix" | null;

interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  category: string | null;
  priority: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface FormData {
  title: string;
  description: string;
  status: Status;
  category: Category;
}

const statusOptions: {
  value: Status;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "planned", label: "Planlagt", icon: Lightbulb },
  { value: "in-progress", label: "Under udvikling", icon: Hammer },
  { value: "completed", label: "Færdigt", icon: CheckCircle2 },
];

const categoryOptions: { value: Category; label: string }[] = [
  { value: null, label: "Ingen kategori" },
  { value: "Feature", label: "Feature" },
  { value: "Improvement", label: "Improvement" },
  { value: "Bug Fix", label: "Bug Fix" },
];

const statusColors: Record<Status, string> = {
  planned: "bg-amber-100 text-amber-700",
  "in-progress": "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
};

function RoadmapForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading,
}: {
  initialData?: FormData;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState<FormData>(
    initialData || {
      title: "",
      description: "",
      status: "planned",
      category: "Feature",
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error("Titel er påkrævet");
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="rm-title"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Titel *
        </label>
        <input
          id="rm-title"
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="F.eks. Multi-currency support"
        />
      </div>

      <div>
        <label
          htmlFor="rm-desc"
          className="mb-1 block text-sm font-medium text-gray-700"
        >
          Beskrivelse
        </label>
        <textarea
          id="rm-desc"
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          rows={3}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          placeholder="Kort beskrivelse af featuren…"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="rm-status"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Status
          </label>
          <select
            id="rm-status"
            value={formData.status}
            onChange={(e) =>
              setFormData({ ...formData, status: e.target.value as Status })
            }
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="rm-category"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Kategori
          </label>
          <select
            id="rm-category"
            value={formData.category || ""}
            onChange={(e) =>
              setFormData({
                ...formData,
                category: (e.target.value || null) as Category,
              })
            }
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {categoryOptions.map((option) => (
              <option key={option.value || "none"} value={option.value || ""}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <X className="h-4 w-4" />
          Annuller
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {isLoading ? "Gemmer…" : "Gem"}
        </button>
      </div>
    </form>
  );
}

function RoadmapItemRow({
  item,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: {
  item: RoadmapItem;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          className="p-1 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30"
          title="Flyt op"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          className="p-1 text-gray-400 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-30"
          title="Flyt ned"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <h4 className="truncate font-medium text-gray-900">{item.title}</h4>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              statusColors[item.status as Status] ?? "bg-gray-100 text-gray-700"
            }`}
          >
            {statusOptions.find((s) => s.value === item.status)?.label ??
              item.status}
          </span>
          {item.category && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {item.category}
            </span>
          )}
        </div>
        {item.description && (
          <p className="truncate text-sm text-gray-500">{item.description}</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="p-2 text-gray-400 transition-colors hover:text-brand-600"
          title="Rediger"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-2 text-gray-400 transition-colors hover:text-red-600"
          title="Slet"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function AdminRoadmapPage() {
  const [isCreating, setIsCreating] = useState(false);
  const [editingItem, setEditingItem] = useState<RoadmapItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const utils = trpc.useUtils();
  const { data: items, isLoading } = trpc.roadmap.getAllAdmin.useQuery();

  const createMutation = trpc.roadmap.create.useMutation({
    onSuccess: () => {
      toast.success("Roadmap item oprettet");
      utils.roadmap.invalidate();
      setIsCreating(false);
    },
    onError: (error) => toast.error(`Fejl: ${error.message}`),
  });

  const updateMutation = trpc.roadmap.update.useMutation({
    onSuccess: () => {
      toast.success("Roadmap item opdateret");
      utils.roadmap.invalidate();
      setEditingItem(null);
    },
    onError: (error) => toast.error(`Fejl: ${error.message}`),
  });

  const deleteMutation = trpc.roadmap.delete.useMutation({
    onSuccess: () => {
      toast.success("Roadmap item slettet");
      utils.roadmap.invalidate();
    },
    onError: (error) => toast.error(`Fejl: ${error.message}`),
  });

  const reorderMutation = trpc.roadmap.reorder.useMutation({
    onSuccess: () => utils.roadmap.invalidate(),
  });

  const handleCreate = (data: FormData) => {
    createMutation.mutate({
      title: data.title,
      description: data.description || undefined,
      status: data.status,
      category: data.category || undefined,
    });
  };

  const handleUpdate = (data: FormData) => {
    if (!editingItem) return;
    updateMutation.mutate({
      id: editingItem.id,
      title: data.title,
      description: data.description || null,
      status: data.status,
      category: data.category,
    });
  };

  const handleReorder = (itemId: string, direction: "up" | "down") => {
    if (!items) return;
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;

    const updatedItems = items.map((item, i) => {
      if (i === index)
        return { id: item.id, priority: items[newIndex].priority };
      if (i === newIndex)
        return { id: item.id, priority: items[index].priority };
      return { id: item.id, priority: item.priority };
    });
    reorderMutation.mutate({ items: updatedItems });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Roadmap</h1>
          <p className="mt-1 text-sm text-gray-500">
            Administrer produktets roadmap som vises på den offentlige
            roadmap-side
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/roadmap"
            target="_blank"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <ExternalLink className="h-4 w-4" />
            Se public side
          </Link>
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            Tilføj item
          </button>
        </div>
      </div>

      {isCreating && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Nyt roadmap item
          </h3>
          <RoadmapForm
            onSubmit={handleCreate}
            onCancel={() => setIsCreating(false)}
            isLoading={createMutation.isPending}
          />
        </div>
      )}

      {editingItem && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-900">
            Rediger roadmap item
          </h3>
          <RoadmapForm
            initialData={{
              title: editingItem.title,
              description: editingItem.description || "",
              status: editingItem.status as Status,
              category: editingItem.category as Category,
            }}
            onSubmit={handleUpdate}
            onCancel={() => setEditingItem(null)}
            isLoading={updateMutation.isPending}
          />
        </div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-gray-100"
              />
            ))}
          </div>
        ) : items?.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center">
            <Lightbulb className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-medium text-gray-900">
              Ingen roadmap items endnu
            </h3>
            <p className="mb-4 text-gray-500">
              Opret dit første roadmap item for at komme i gang.
            </p>
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              <Plus className="h-4 w-4" />
              Opret første item
            </button>
          </div>
        ) : (
          items?.map((item, index) => (
            <RoadmapItemRow
              key={item.id}
              item={item}
              onEdit={() => setEditingItem(item)}
              onDelete={() => setDeleteConfirmId(item.id)}
              onMoveUp={() => handleReorder(item.id, "up")}
              onMoveDown={() => handleReorder(item.id, "down")}
              isFirst={index === 0}
              isLast={index === items.length - 1}
            />
          ))
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        <h3 className="mb-2 font-medium text-gray-900">Tips</h3>
        <ul className="space-y-1">
          <li>• Brug pile-knapperne til at ændre rækkefølgen af items.</li>
          <li>
            • Items med status "Færdigt" vises i "Completed" kolonnen på den
            offentlige side.
          </li>
          <li>
            • Kategori badges hjælper brugere med at forstå typen af opdatering.
          </li>
        </ul>
      </div>

      <ConfirmDialog
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) {
            deleteMutation.mutate({ id: deleteConfirmId });
            setDeleteConfirmId(null);
          }
        }}
        title="Slet roadmap item"
        description="Er du sikker på, at du vil slette dette item?"
        confirmLabel="Slet"
        variant="danger"
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
