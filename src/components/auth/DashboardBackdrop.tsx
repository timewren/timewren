/**
 * Static decorative dashboard wireframe used as a background behind auth pages.
 * Purely visual — no data, no interactivity.
 */
export function DashboardBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 overflow-hidden bg-gray-50 dark:bg-gray-950"
    >
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 w-64 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* Logo area */}
        <div className="flex h-14 items-center border-b border-gray-200 dark:border-gray-800 px-6">
          <div className="h-7 w-28 rounded bg-gray-200 dark:bg-gray-700" />
        </div>

        {/* Nav items */}
        <div className="space-y-1.5 px-3 py-4">
          {/* Active item */}
          <div className="flex items-center gap-3 rounded-lg bg-brand-50 dark:bg-tt-gran-lys px-3 py-2">
            <div className="h-5 w-5 rounded bg-brand-200 dark:bg-tt-gran-lys" />
            <div className="h-4 w-20 rounded bg-brand-200 dark:bg-tt-gran-lys" />
          </div>
          <NavRow w={16} />
          <NavRow w={24} />
          <NavRow w={20} />
          <NavRow w={18} />
          <NavRow w={22} />
          <NavRow w={14} />
        </div>
      </div>

      {/* Main content area */}
      <div className="pl-64">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-8">
          <div className="h-8 w-48 rounded-lg bg-gray-100 dark:bg-gray-800" />
          <div className="ml-auto flex items-center gap-3">
            <div className="h-8 w-24 rounded-lg bg-green-100 dark:bg-green-900/30" />
            <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>

        {/* Dashboard content skeleton */}
        <div className="p-6 space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard bg="bg-brand-50 dark:bg-tt-gran-lys" />
            <StatCard bg="bg-green-50 dark:bg-green-900/10" />
            <StatCard bg="bg-purple-50 dark:bg-purple-900/10" />
            <StatCard bg="bg-amber-50 dark:bg-amber-900/10" />
          </div>

          {/* Two column layout */}
          <div className="grid grid-cols-3 gap-4">
            {/* Chart card */}
            <div className="col-span-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <div className="h-4 w-32 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-6 flex items-end gap-3 h-40">
                <Bar h={40} />
                <Bar h={65} />
                <Bar h={45} />
                <Bar h={80} />
                <Bar h={55} />
                <Bar h={70} />
                <Bar h={35} />
                <Bar h={60} />
                <Bar h={75} />
                <Bar h={50} />
                <Bar h={85} />
                <Bar h={45} />
              </div>
            </div>

            {/* Side card */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <div className="h-4 w-24 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="mt-4 space-y-3">
                <ListRow w={70} />
                <ListRow w={55} />
                <ListRow w={40} />
                <ListRow w={85} />
                <ListRow w={30} />
              </div>
            </div>
          </div>

          {/* Table card */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="h-4 w-36 rounded bg-gray-200 dark:bg-gray-700" />
            <div className="mt-4 space-y-2.5">
              {/* Header row */}
              <div className="flex gap-4 pb-2 border-b border-gray-100 dark:border-gray-800">
                <div className="h-3 rounded bg-gray-300 dark:bg-gray-600 flex-[2]" />
                <div className="h-3 rounded bg-gray-300 dark:bg-gray-600 flex-1" />
                <div className="h-3 rounded bg-gray-300 dark:bg-gray-600 flex-1" />
                <div className="h-3 rounded bg-gray-300 dark:bg-gray-600 flex-1" />
              </div>
              {/* Data rows */}
              <TableRow />
              <TableRow />
              <TableRow />
              <TableRow />
              <TableRow />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavRow({ w }: { w: number }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="h-5 w-5 rounded bg-gray-200 dark:bg-gray-700" />
      <div
        className="h-4 rounded bg-gray-200 dark:bg-gray-700"
        style={{ width: `${w * 4}px` }}
      />
    </div>
  );
}

function StatCard({ bg }: { bg: string }) {
  return (
    <div
      className={`rounded-xl border border-gray-200 dark:border-gray-800 p-5 ${bg}`}
    >
      <div className="h-3 w-16 rounded bg-gray-300/50 dark:bg-gray-600/50" />
      <div className="mt-3 h-7 w-20 rounded bg-gray-300/60 dark:bg-gray-600/60" />
      <div className="mt-2 h-2.5 w-24 rounded bg-gray-200/60 dark:bg-gray-700/60" />
    </div>
  );
}

function Bar({ h }: { h: number }) {
  return (
    <div
      className="flex-1 rounded-t bg-brand-200/60 dark:bg-tt-gran-lys"
      style={{ height: `${h}%` }}
    />
  );
}

function ListRow({ w }: { w: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-gray-100 dark:bg-gray-800" />
      <div className="flex-1 space-y-1.5">
        <div
          className="h-3 rounded bg-gray-200 dark:bg-gray-700"
          style={{ width: `${w}%` }}
        />
        <div className="h-2 w-12 rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    </div>
  );
}

function TableRow() {
  return (
    <div className="flex gap-4 py-1.5">
      <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 flex-[2]" />
      <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 flex-1" />
      <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 flex-1" />
      <div className="h-3 rounded bg-gray-100 dark:bg-gray-800 flex-1" />
    </div>
  );
}
