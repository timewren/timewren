"use client";

import {
  ArrowLeft,
  CircleDot,
  Clock,
  Loader2,
  Mail,
  StickyNote,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import sanitizeHtml from "sanitize-html";
import { toast } from "sonner";
import { FoundingSupportBadge } from "@/components/admin/FoundingSupportBadge";
import { SupportReplyBox } from "@/components/admin/SupportReplyBox";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { trpc } from "@/providers/trpc-provider";

const statusOptions = [
  { value: "open", label: "Aaben", color: "text-green-600 bg-green-50" },
  {
    value: "in_progress",
    label: "I gang",
    color: "text-yellow-600 bg-yellow-50",
  },
  { value: "closed", label: "Lukket", color: "text-gray-600 bg-gray-100" },
];

const priorityOptions = [
  { value: "low", label: "Lav" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "Hoej" },
];

function formatTimestamp(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString("da-DK", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SupportTicketPage() {
  const params = useParams();
  const ticketId = params.ticketId as string;
  const utils = trpc.useUtils();

  const { data: ticket, isLoading } = trpc.admin.getTicket.useQuery({
    ticketId,
  });
  const { data: signatureHtml } = trpc.admin.getSignature.useQuery();
  const { data: assignableUsers } = trpc.admin.getAssignableUsers.useQuery();

  const updateStatus = trpc.admin.updateStatus.useMutation({
    onSuccess: () => {
      utils.admin.getTicket.invalidate({ ticketId });
      utils.admin.list.invalidate();
      utils.admin.counts.invalidate();
      toast.success("Status opdateret");
    },
  });

  const assign = trpc.admin.assign.useMutation({
    onSuccess: () => {
      utils.admin.getTicket.invalidate({ ticketId });
      toast.success("Tildeling opdateret");
    },
  });

  const updatePriority = trpc.admin.updatePriority.useMutation({
    onSuccess: () => {
      utils.admin.getTicket.invalidate({ ticketId });
      toast.success("Prioritet opdateret");
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="py-20 text-center text-gray-400">Ticket ikke fundet</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link + header */}
      <div>
        <Link
          href="/admin/support"
          className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tilbage til oversigt
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-gray-900">
              {ticket.subject}
              {ticket.isFounding && (
                <span className="ml-3 align-middle">
                  <FoundingSupportBadge />
                </span>
              )}
            </h1>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
              <span>
                Fra: {ticket.senderName} ({ticket.senderEmail})
              </span>
              {ticket.inbox && (
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: `${ticket.inbox.color}15`,
                    color: ticket.inbox.color,
                  }}
                >
                  {ticket.inbox.name}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Message thread */}
        <div className="space-y-4 lg:col-span-3">
          {ticket.messages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            const isInternal = msg.isInternal;

            if (isInternal) {
              return (
                <div
                  key={msg.id}
                  className="rounded-lg border border-yellow-200 bg-yellow-50 p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <StickyNote className="h-3.5 w-3.5 text-yellow-600" />
                    <span className="text-xs font-medium text-yellow-700">
                      Intern note
                    </span>
                    <span className="text-xs text-yellow-500">
                      {msg.fromName} - {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-yellow-900">
                    {msg.bodyText || msg.body}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg p-4 ${
                    isInbound
                      ? "border border-gray-200 bg-gray-50"
                      : "border border-brand-200 bg-brand-50"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    {isInbound ? (
                      <Mail className="h-3.5 w-3.5 text-gray-400" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-brand-400" />
                    )}
                    <span
                      className={`text-xs font-medium ${isInbound ? "text-gray-700" : "text-brand-700 dark:text-brand-400"}`}
                    >
                      {msg.fromName}
                    </span>
                    <span className="text-xs text-gray-400">
                      {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    className="typeset typeset-app text-gray-900 dark:text-gray-100"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized email content
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtml(msg.body, {
                        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
                          "img",
                        ]),
                        allowedAttributes: {
                          ...sanitizeHtml.defaults.allowedAttributes,
                          // style er bevidst udeladt (#203): utrusted email-
                          // HTML i admin-kontekst må ikke kunne CSS-redresse
                          img: ["src", "alt", "width", "height"],
                          "*": ["class"],
                        },
                      }),
                    }}
                  />
                </div>
              </div>
            );
          })}

          {/* Reply box */}
          <SupportReplyBox
            ticketId={ticketId}
            signatureHtml={signatureHtml ?? ""}
          />
        </div>

        {/* Right sidebar: ticket metadata */}
        <div className="space-y-4">
          {/* Status */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Status
            </h3>
            <select
              value={ticket.status}
              onChange={(e) =>
                updateStatus.mutate({
                  ticketId,
                  status: e.target.value as "open" | "in_progress" | "closed",
                })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Priority */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Prioritet
            </h3>
            <select
              value={ticket.priority}
              onChange={(e) =>
                updatePriority.mutate({
                  ticketId,
                  priority: e.target.value as "low" | "normal" | "high",
                })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {priorityOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Assignment */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Tildelt
            </h3>
            <select
              value={ticket.assignedTo ?? ""}
              onChange={(e) =>
                assign.mutate({
                  ticketId,
                  assignedTo: e.target.value || null,
                })
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Ingen</option>
              {assignableUsers?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>

          {/* Info */}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Detaljer
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                <span>Oprettet: {formatTimestamp(ticket.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Clock className="h-3.5 w-3.5 text-gray-400" />
                <span>Opdateret: {formatTimestamp(ticket.updatedAt)}</span>
              </div>
              {ticket.closedAt && (
                <div className="flex items-center gap-2 text-gray-600">
                  <CircleDot className="h-3.5 w-3.5 text-gray-400" />
                  <span>Lukket: {formatTimestamp(ticket.closedAt)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Matched user */}
          {ticket.user && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Matchet bruger
              </h3>
              <Link
                href={`/admin/users/${ticket.user.id}`}
                className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-gray-50"
              >
                <UserAvatar
                  name={ticket.user.name}
                  image={ticket.user.image}
                  size="sm"
                  alt=""
                  fallbackClassName="bg-brand-100 text-brand-600 dark:text-brand-400"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {ticket.user.name}
                  </p>
                  <p className="text-xs text-gray-500">{ticket.user.email}</p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
