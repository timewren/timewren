export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="h-5 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Stats grid skeleton */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton list that never changes
            key={i}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div className="h-12 w-12 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-8 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions skeleton */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton list that never changes
              key={i}
              className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700"
            />
          ))}
        </div>
      </div>

      {/* Content skeleton */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <div className="mb-4 h-6 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton list that never changes
              key={i}
              className="h-16 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
