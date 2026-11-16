"use client";

import {
  Bug,
  CheckCircle2,
  Hammer,
  Lightbulb,
  Sparkles,
  Tag,
  Wrench,
} from "lucide-react";
import type React from "react";

import { trpc } from "@/providers/trpc-provider";

const statusConfig = {
  planned: {
    icon: Lightbulb,
    title: "Planlagt",
    description: "Det vi gerne vil bygge (når det giver mest mening)",
    bgColor: "bg-amber-50 dark:bg-amber-900/20",
    borderColor: "border-amber-200 dark:border-amber-800",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  "in-progress": {
    icon: Hammer,
    title: "Under udvikling",
    description: "Det vi aktivt arbejder på lige nu",
    bgColor: "bg-blue-50 dark:bg-blue-900/20",
    borderColor: "border-blue-200 dark:border-blue-800",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  completed: {
    icon: CheckCircle2,
    title: "Færdigt",
    description: "Ting der allerede er live",
    bgColor: "bg-green-50 dark:bg-green-900/20",
    borderColor: "border-green-200 dark:border-green-800",
    iconColor: "text-green-600 dark:text-green-400",
  },
};

const categoryConfig: Record<
  string,
  { icon: React.ElementType; className: string }
> = {
  Feature: {
    icon: Sparkles,
    className:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  Improvement: {
    icon: Wrench,
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  "Bug Fix": {
    icon: Bug,
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
};

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;

  const config = categoryConfig[category] || {
    icon: Tag,
    className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
  };

  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
    >
      <Icon className="h-3 w-3" />
      {category}
    </span>
  );
}

interface RoadmapItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  category: string | null;
  priority: number;
  completedAt: Date | null;
  createdAt: Date;
}

function RoadmapCard({ item }: { item: RoadmapItem }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h4 className="font-semibold text-gray-900 dark:text-white">
          {item.title}
        </h4>
        <CategoryBadge category={item.category} />
      </div>
      {item.description && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {item.description}
        </p>
      )}
    </div>
  );
}

function RoadmapColumn({
  status,
  items,
}: {
  status: "planned" | "in-progress" | "completed";
  items: RoadmapItem[];
}) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-4`}
    >
      <div className="mb-4 flex items-center gap-2">
        <div
          className={`rounded-lg bg-white p-2 dark:bg-gray-900 ${config.iconColor}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {config.title}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {config.description}
          </p>
        </div>
        <span className="ml-auto rounded-full bg-white px-2 py-1 text-sm font-medium text-gray-600 dark:bg-gray-900 dark:text-gray-400">
          {items.length}
        </span>
      </div>

      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
            Ingen items endnu
          </p>
        ) : (
          items.map((item) => <RoadmapCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function RoadmapSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/50"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1">
              <div className="mb-1 h-5 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
          <div className="space-y-3">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-3 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RoadmapBoard() {
  const { data: roadmapData, isLoading } = trpc.roadmap.getAll.useQuery();

  if (isLoading) return <RoadmapSkeleton />;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      <RoadmapColumn
        status="planned"
        items={(roadmapData?.planned || []) as RoadmapItem[]}
      />
      <RoadmapColumn
        status="in-progress"
        items={(roadmapData?.["in-progress"] || []) as RoadmapItem[]}
      />
      <RoadmapColumn
        status="completed"
        items={(roadmapData?.completed || []) as RoadmapItem[]}
      />
    </div>
  );
}
