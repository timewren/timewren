"use client";

import type { HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({
  variant = "text",
  width,
  height,
  lines = 1,
  className = "",
  ...props
}: SkeletonProps) {
  const baseClasses = "animate-pulse bg-gray-200 dark:bg-gray-700";

  const variantClasses = {
    text: "rounded",
    circular: "rounded-full",
    rectangular: "rounded-lg",
  };

  const style = {
    width: typeof width === "number" ? `${width}px` : width,
    height: typeof height === "number" ? `${height}px` : height,
  };

  if (variant === "text" && lines > 1) {
    return (
      <div className={`space-y-2 ${className}`} {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
            key={i}
            className={`${baseClasses} ${variantClasses[variant]} h-4 ${
              i === lines - 1 ? "w-3/4" : "w-full"
            }`}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
      style={style}
      {...props}
    />
  );
}

// Pre-built skeleton patterns
export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <Skeleton variant="circular" width={48} height={48} />
        <div className="flex-1 space-y-2">
          <Skeleton width="60%" height={20} />
          <Skeleton width="40%" height={16} />
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton lines={3} />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-8">
          <Skeleton width={100} height={16} />
          <Skeleton width={120} height={16} />
          <Skeleton width={80} height={16} />
          <Skeleton width={100} height={16} />
        </div>
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
          key={i}
          className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 last:border-b-0"
        >
          <div className="flex items-center gap-8">
            <Skeleton width={100} height={16} />
            <Skeleton width={120} height={16} />
            <Skeleton width={80} height={16} />
            <Skeleton width={100} height={16} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonList({ items = 5 }: { items?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: items }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
          key={i}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
        >
          <div className="flex items-center gap-4">
            <Skeleton variant="circular" width={40} height={40} />
            <div className="flex-1">
              <Skeleton width="50%" height={18} className="mb-2" />
              <Skeleton width="30%" height={14} />
            </div>
            <Skeleton width={80} height={32} variant="rectangular" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
          key={i}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6"
        >
          <Skeleton width={100} height={14} className="mb-2" />
          <Skeleton width={80} height={32} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDashboard() {
  return (
    <div className="space-y-6">
      {/* Stats row */}
      <SkeletonStats />

      {/* Content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Table */}
      <SkeletonTable rows={3} />
    </div>
  );
}

// Page loading skeletons
export function ClientsPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton width={200} height={36} className="mb-2" />
          <Skeleton width={300} height={20} />
        </div>
        <Skeleton width={140} height={44} variant="rectangular" />
      </div>

      {/* Search/filter bar */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex gap-4">
          <Skeleton className="flex-1" height={40} variant="rectangular" />
          <Skeleton width={150} height={40} variant="rectangular" />
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

export function ProjectsPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton width={180} height={36} className="mb-2" />
          <Skeleton width={280} height={20} />
        </div>
        <Skeleton width={130} height={44} variant="rectangular" />
      </div>

      {/* Search/filter bar */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex gap-4">
          <Skeleton className="flex-1" height={40} variant="rectangular" />
          <Skeleton width={140} height={40} variant="rectangular" />
        </div>
      </div>

      {/* List */}
      <SkeletonList items={5} />
    </div>
  );
}

export function InvoicesPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton width={160} height={36} className="mb-2" />
          <Skeleton width={320} height={20} />
        </div>
        <Skeleton width={130} height={44} variant="rectangular" />
      </div>

      {/* Stats */}
      <SkeletonStats />

      {/* Search bar */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex gap-4">
          <Skeleton className="flex-1" height={40} variant="rectangular" />
          <Skeleton width={120} height={40} variant="rectangular" />
        </div>
      </div>

      {/* Table */}
      <SkeletonTable rows={5} />
    </div>
  );
}

export function TimePageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Timer Widget */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="flex gap-2">
            <Skeleton width={100} height={36} variant="rectangular" />
            <Skeleton width={100} height={36} variant="rectangular" />
          </div>
          {/* Project select */}
          <Skeleton height={44} variant="rectangular" />
          {/* Description */}
          <Skeleton height={44} variant="rectangular" />
          {/* Timer display */}
          <div className="flex justify-center py-4">
            <Skeleton width={180} height={48} />
          </div>
          {/* Timer buttons */}
          <div className="flex justify-center gap-2">
            <Skeleton width={48} height={48} variant="rectangular" />
            <Skeleton width={48} height={48} variant="rectangular" />
          </div>
        </div>
      </div>

      {/* Date selector */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton width={140} height={36} variant="rectangular" />
            <Skeleton width={80} height={32} variant="rectangular" />
          </div>
          <Skeleton width={100} height={20} />
        </div>
      </div>

      {/* Time entries list */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="border-b border-gray-200 dark:border-gray-700 p-4">
          <Skeleton width={140} height={20} />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
            key={i}
            className="flex items-center gap-4 p-4 border-b border-gray-200 dark:border-gray-700 last:border-b-0"
          >
            <Skeleton width={16} height={16} variant="rectangular" />
            <div className="flex-1 min-w-0">
              <Skeleton width="60%" height={16} className="mb-1" />
              <Skeleton width="40%" height={14} />
            </div>
            <Skeleton width={64} height={20} />
            <Skeleton width={80} height={20} />
            <div className="flex gap-1">
              <Skeleton width={32} height={32} variant="rectangular" />
              <Skeleton width={32} height={32} variant="rectangular" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Skeleton width={200} height={32} className="mb-2" />
          <Skeleton width={300} height={18} />
        </div>
        <Skeleton width={120} height={40} variant="rectangular" />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
            key={i}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
          >
            <div className="flex items-center gap-3 mb-2">
              <Skeleton width={40} height={40} variant="circular" />
              <div>
                <Skeleton width={60} height={12} className="mb-1" />
                <Skeleton width={80} height={24} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Widgets grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Widget 1 */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton width={20} height={20} variant="circular" />
            <Skeleton width={120} height={18} />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
              <Skeleton key={i} height={56} variant="rectangular" />
            ))}
          </div>
        </div>
        {/* Widget 2 */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton width={20} height={20} variant="circular" />
            <Skeleton width={140} height={18} />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fast længde uden data: elementerne har kun deres position som identitet
              <Skeleton key={i} height={56} variant="rectangular" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
