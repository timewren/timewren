"use client";

import { CircleDot, Inbox, Loader2, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { FoundingSupportBadge } from "@/components/admin/FoundingSupportBadge";
import { trpc } from "@/providers/trpc-provider";

type StatusTab = "open" | "in_progress" | "closed" | "all";

const statusTabs: { key: StatusTab; label: string }[] = [
  { key: "open", label: "Aabne" },
  { key: "in_progress", label: "I gang" },
  { key: "closed", label: "Lukkede" },
  { key: "all", label: "Alle" },
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").slice(0, 120);
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Nu";
  if (diffMins < 60) return `${diffMins}m siden`;
  if (diffHours < 24) return `${diffHours}t siden`;
  if (diffDays < 7) return `${diffDays}d siden`;
  return d.toLocaleDateString("da-DK", {
    day: "numeric",
    month: "short",
  });
}

export default function AdminSupportPage() {
  const [status, setStatus] = useState<StatusTab>("open");
  const [search, setSearch] = useState("");
  const [inboxFilter, setInboxFilter] = useState<string>("");

  const { data: counts } = trpc.admin.counts.useQuery();
  const { data: inboxes } = trpc.admin.getInboxes.useQuery();
  const { data, isLoading } = trpc.admin.list.useQuery({
    status,
    search: search || undefined,
    inboxId: inboxFilter || undefined,
  });

  const tickets = data?.tickets ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Support</h1>
          <p className="mt-1 text-sm text-gray-500">
            Administrer support tickets fra kunder
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {statusTabs.map((tab) => {
          const count =
            tab.key === "all"
              ? (counts?.open ?? 0) +
                (counts?.in_progress ?? 0) +
                (counts?.closed ?? 0)
              : (counts?.[tab.key] ?? 0);

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatus(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                status === tab.key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs ${
                    status === tab.key
                      ? "bg-brand-100 text-brand-700"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Soeg i emne eller afsender..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        {inboxes && inboxes.length > 1 ? (
          <select
            value={inboxFilter}
            onChange={(e) => setInboxFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="">Alle indbakker</option>
            {inboxes.map((inbox) => (
              <option key={inbox.id} value={inbox.id}>
                {inbox.name}
              </option>
            ))}
          </select>
        ) : inboxes && inboxes.length === 1 ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
            title={`Tickets fra ${inboxes[0].name}`}
          >
            <Inbox className="h-4 w-4 text-gray-400" />
            <span>{inboxes[0].name}</span>
          </div>
        ) : null}
      </div>

      {/* Ticket list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Inbox className="mb-3 h-10 w-10" />
          <p className="text-sm">Ingen tickets fundet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Emne
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Afsender
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Bruger
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Indbakke
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Tildelt
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Dato
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3">
                    <CircleDot
                      className={`h-3.5 w-3.5 ${
                        ticket.status === "open"
                          ? "text-green-500"
                          : ticket.status === "in_progress"
                            ? "text-yellow-500"
                            : "text-gray-400"
                      }`}
                    />
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <Link
                      href={`/admin/support/${ticket.id}`}
                      className="block"
                    >
                      <p className="truncate text-sm font-medium text-gray-900 hover:text-brand-600">
                        {ticket.subject}
                      </p>
                      {ticket.isFounding && (
                        <span className="mt-0.5 inline-block">
                          <FoundingSupportBadge />
                        </span>
                      )}
                      {ticket.latestMessage &&
                        !ticket.latestMessage.isInternal && (
                          <p className="mt-0.5 truncate text-xs text-gray-500">
                            {stripHtml(ticket.latestMessage.body)}
                          </p>
                        )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="text-sm text-gray-900">
                        {ticket.senderName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {ticket.senderEmail}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {ticket.user ? (
                      <Link
                        href={`/admin/users/${ticket.user.id}`}
                        className="text-sm text-brand-600 hover:underline"
                      >
                        {ticket.user.name}
                      </Link>
                    ) : (
                      <span className="text-xs text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {ticket.inbox && (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `${ticket.inbox.color}15`,
                          color: ticket.inbox.color,
                        }}
                      >
                        {ticket.inbox.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {ticket.assignee?.name ?? (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatDate(ticket.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
