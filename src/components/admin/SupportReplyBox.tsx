"use client";

import { Loader2, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc-provider";
import { TemplateInsertDropdown } from "./TemplateInsertDropdown";

interface SupportReplyBoxProps {
  ticketId: string;
  signatureHtml: string;
  ticketContext?: {
    senderName?: string;
    senderEmail?: string;
    subject?: string;
    company?: string;
  };
  agentName?: string;
}

export function SupportReplyBox({
  ticketId,
  signatureHtml,
  ticketContext,
  agentName,
}: SupportReplyBoxProps) {
  const [body, setBody] = useState("");
  const utils = trpc.useUtils();

  const replyMutation = trpc.admin.reply.useMutation({
    onSuccess: () => {
      setBody("");
      utils.admin.getTicket.invalidate({ ticketId });
      utils.admin.list.invalidate();
      utils.admin.counts.invalidate();
      toast.success("Svar sendt");
    },
    onError: (err) => {
      toast.error(`Kunne ikke sende svar: ${err.message}`);
    },
  });

  const noteMutation = trpc.admin.addNote.useMutation({
    onSuccess: () => {
      setBody("");
      utils.admin.getTicket.invalidate({ ticketId });
      toast.success("Intern note gemt");
    },
    onError: (err) => {
      toast.error(`Kunne ikke gemme note: ${err.message}`);
    },
  });

  const isSending = replyMutation.isPending || noteMutation.isPending;

  const handleReply = () => {
    if (!body.trim()) {
      toast.error("Skriv en besked foerst");
      return;
    }
    replyMutation.mutate({ ticketId, body: body.trim() });
  };

  const handleNote = () => {
    if (!body.trim()) {
      toast.error("Skriv en note foerst");
      return;
    }
    noteMutation.mutate({ ticketId, body: body.trim() });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="p-4">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Skriv dit svar..."
          rows={5}
          disabled={isSending}
          className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />

        {/* Signature preview */}
        {signatureHtml && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="mb-1 text-xs font-medium text-gray-400">Signatur</p>
            <div
              className="text-xs italic text-gray-400"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Admin-controlled signature
              dangerouslySetInnerHTML={{ __html: signatureHtml }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-4 py-3">
        <TemplateInsertDropdown
          onInsert={(text) =>
            setBody((prev) => (prev ? `${prev}\n\n${text}` : text))
          }
          ticketContext={ticketContext}
          agentName={agentName}
        />
        <button
          type="button"
          onClick={handleNote}
          disabled={isSending || !body.trim()}
          className="flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-800 transition-colors hover:bg-yellow-100 disabled:opacity-50"
        >
          {noteMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5" />
          )}
          Gem som intern note
        </button>
        <button
          type="button"
          onClick={handleReply}
          disabled={isSending || !body.trim()}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {replyMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Send svar
        </button>
      </div>
    </div>
  );
}
