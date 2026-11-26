import {
  type InfiniteData,
  type QueryKey,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { flattenTaskPages, type TaskCursor } from "@/lib/tasks/task-pages";

export function useTaskPages<Row extends { id: string }>(
  queryKey: QueryKey,
  fetchPage: (
    cursor: TaskCursor | null,
    signal: AbortSignal,
  ) => Promise<{ rows: Row[]; nextCursor: TaskCursor | null }>,
  enabled = true,
) {
  type Page = { rows: Row[]; nextCursor: TaskCursor | null };
  const query = useInfiniteQuery<
    Page,
    Error,
    InfiniteData<Page, TaskCursor | null>,
    QueryKey,
    TaskCursor | null
  >({
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor,
    enabled,
  });
  const { data, fetchNextPage, hasNextPage, isFetching, isError } = query;
  useEffect(() => {
    if (enabled && hasNextPage && !isFetching && !isError) {
      void fetchNextPage();
    }
  }, [enabled, fetchNextPage, hasNextPage, isFetching, isError]);

  const rows = useMemo(
    () => (data ? flattenTaskPages(data.pages) : undefined),
    [data],
  );
  return { ...query, rows };
}
