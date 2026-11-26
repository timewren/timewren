"use client";

import type { inferRouterInputs } from "@trpc/server";
import type { TIME_LIST_SUMMARY_COLUMNS } from "@/lib/time/list-summary";
import type { AppRouter, RouterOutputs } from "@/lib/trpc/routers";
import { trpc } from "@/providers/trpc-provider";

type C = typeof TIME_LIST_SUMMARY_COLUMNS;
type FullList = RouterOutputs["time"]["list"];
type FullEntry = FullList["entries"][number];
type FullProject = NonNullable<FullEntry["project"]>;

type Picked<T, Columns> = T extends null
  ? null
  : Pick<NonNullable<T>, Extract<keyof Columns, keyof NonNullable<T>>>;

/** A time.list entry in the summary view: only the trimmed relation columns. */
export type TimeListSummaryEntry = Omit<
  FullEntry,
  "project" | "client" | "prepaidPackage"
> & {
  project:
    | (Picked<FullProject, C["project"]> & {
        client: Picked<FullProject["client"], C["client"]> | null;
      })
    | null;
  client: Picked<FullEntry["client"], C["client"]> | null;
  prepaidPackage: Picked<
    FullEntry["prepaidPackage"],
    C["prepaidPackage"]
  > | null;
};

export type TimeListSummary = Omit<FullList, "entries"> & {
  entries: TimeListSummaryEntry[];
};

type Input = Omit<
  NonNullable<inferRouterInputs<AppRouter>["time"]["list"]>,
  "view"
>;
type Options = Parameters<typeof trpc.time.list.useQuery>[1];

/**
 * `trpc.time.list.useQuery` with `view: "summary"` (src/lib/time/list-summary.ts):
 * far smaller responses, and typed so a page can only read the columns the
 * summary view returns. Same procedure and cache key prefix, so every
 * `utils.time.list.invalidate()` refreshes it too.
 */
export function useTimeListSummary(input: Input, options?: Options) {
  const query = trpc.time.list.useQuery({ ...input, view: "summary" }, options);
  return query as Omit<typeof query, "data"> & {
    data: TimeListSummary | undefined;
  };
}
