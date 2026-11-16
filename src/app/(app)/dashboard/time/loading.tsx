export default function TimeLoading() {
  return (
    <div className="space-y-4">
      {/* Header skeleton */}
      <div>
        <div className="h-9 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        <div className="mt-2 h-5 w-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Timer card skeleton */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 shadow-sm">
        <div className="space-y-4">
          <div className="h-6 w-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="h-10 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          </div>
          <div className="h-20 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          <div className="flex gap-3">
            <div className="h-10 flex-1 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
            <div className="h-10 w-24 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>

      {/* Time entries list skeleton */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
        <div className="border-b p-4">
          <div className="h-6 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="divide-y">
          {[...Array(5)].map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton list that never changes
              key={i}
              className="p-4"
            >
              <div className="flex items-center gap-4">
                <div className="h-5 w-5 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-4 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="h-6 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-8 w-8 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
