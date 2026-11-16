export default function ClientsLoading() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div>
          <div className="h-9 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="mt-2 h-5 w-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Search and filter skeleton */}
      <div className="flex gap-4">
        <div className="h-10 flex-1 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="h-10 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Clients list skeleton */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton list that never changes
            key={i}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="h-6 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                  <div className="mt-2 h-4 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="space-y-2">
                <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
              <div className="flex gap-2">
                <div className="h-9 flex-1 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
                <div className="h-9 w-20 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
