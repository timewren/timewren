"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";

export interface AdminTableColumn<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
}

interface AdminTableProps<T> {
  columns: AdminTableColumn<T>[];
  data: T[];
  total: number;
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  emptyIcon?: React.ComponentType<{ className?: string }>;
  emptyMessage?: string;
  rowKey: (row: T) => string;
  selectedIds?: Set<string>;
  onSelectChange?: (ids: Set<string>) => void;
  onRowClick?: (row: T) => void;
}

export function AdminTable<T>({
  columns,
  data,
  total,
  page,
  limit,
  onPageChange,
  isLoading = false,
  emptyIcon: EmptyIcon,
  emptyMessage,
  rowKey,
  selectedIds,
  onSelectChange,
  onRowClick,
}: AdminTableProps<T>) {
  const t = useTranslations("adminShell");
  const totalPages = Math.ceil(total / limit);
  const hasSelection =
    selectedIds !== undefined && onSelectChange !== undefined;

  const allSelected =
    hasSelection &&
    data.length > 0 &&
    data.every((row) => selectedIds.has(rowKey(row)));

  const toggleAll = () => {
    if (!onSelectChange) return;
    if (allSelected) {
      onSelectChange(new Set());
    } else {
      onSelectChange(new Set(data.map(rowKey)));
    }
  };

  const toggleRow = (id: string) => {
    if (!onSelectChange || !selectedIds) return;
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    onSelectChange(next);
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              {hasSelection && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 ${col.className ?? ""}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              Array.from({ length: 5 }, (_, i) => `skeleton-${i}`).map(
                (key) => (
                  <tr key={key}>
                    <td
                      colSpan={columns.length + (hasSelection ? 1 : 0)}
                      className="px-4 py-4"
                    >
                      <div className="h-6 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                    </td>
                  </tr>
                ),
              )
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (hasSelection ? 1 : 0)}
                  className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  {EmptyIcon && (
                    <EmptyIcon className="mx-auto h-10 w-10 mb-2 opacity-50" />
                  )}
                  <p>{emptyMessage ?? t("table.empty")}</p>
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const id = rowKey(row);
                return (
                  <tr
                    key={id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-700/30 ${onRowClick ? "cursor-pointer" : ""}`}
                    onClick={() => onRowClick?.(row)}
                  >
                    {hasSelection && (
                      <td className="w-10 px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(id)}
                          onChange={() => toggleRow(id)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-4 ${col.className ?? ""}`}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 px-4 py-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("table.pageOf", { page: page + 1, total: totalPages })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("table.previous")}
            </button>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {t("table.next")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
