"use client";

import {
  AlertCircle,
  Loader2,
  Mail,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import sanitizeHtml from "sanitize-html";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { trpc } from "@/providers/trpc-provider";

function SafeHtmlPreview({ html }: { html: string }) {
  const sanitized = useMemo(
    () =>
      sanitizeHtml(html, {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([
          "img",
          "h1",
          "h2",
        ]),
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          img: ["src", "alt", "width", "height", "style"],
          a: ["href", "target", "rel", "style"],
          "*": ["style", "class"],
        },
        allowedSchemes: ["https", "http", "mailto"],
      }),
    [html],
  );

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4 typeset typeset-app"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized admin preview
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

export default function BroadcastsPage() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);
  const [confirmSendName, setConfirmSendName] = useState("");

  const utils = trpc.useUtils();
  const { data: broadcasts, isLoading } = trpc.broadcasts.list.useQuery();
  const { data: segments } = trpc.broadcasts.segments.useQuery();

  const createMutation = trpc.broadcasts.create.useMutation({
    onSuccess: () => {
      toast.success("Broadcast oprettet som kladde");
      setShowCreate(false);
      setName("");
      setSubject("");
      setHtml("");
      utils.broadcasts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const sendMutation = trpc.broadcasts.send.useMutation({
    onSuccess: () => {
      toast.success("Broadcast sendt!");
      setConfirmSendId(null);
      setConfirmSendName("");
      utils.broadcasts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMutation = trpc.broadcasts.remove.useMutation({
    onSuccess: () => {
      toast.success("Broadcast slettet");
      utils.broadcasts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Broadcasts</h1>
          <p className="mt-1 text-sm text-gray-500">
            Send nyhedsbreve og produktopdateringer til dine brugere
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> Opret broadcast
        </button>
      </div>

      {segments && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-brand-500" />
                <h3 className="text-sm font-medium text-gray-900">
                  {seg.name}
                </h3>
              </div>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {seg.count}
              </p>
              <p className="text-xs text-gray-500">{seg.description}</p>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({ name, subject, html });
          }}
          className="rounded-lg border border-gray-200 bg-white p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900">Ny broadcast</h2>
          <div>
            <label
              htmlFor="bc-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Navn (internt)
            </label>
            <input
              id="bc-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Februar nyhedsbrev"
              className="w-full rounded-lg border border-gray-300 bg-white text-gray-900 px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label
              htmlFor="bc-subject"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Emne
            </label>
            <input
              id="bc-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              placeholder={`Nyheder fra ${brand.name}`}
              className="w-full rounded-lg border border-gray-300 bg-white text-gray-900 px-4 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label
              htmlFor="bc-html"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Indhold (HTML)
            </label>
            <textarea
              id="bc-html"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              required
              rows={10}
              placeholder="<h1>Hej!</h1><p>Her er nyheder...</p>"
              className="w-full rounded-lg border border-gray-300 bg-white text-gray-900 px-4 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {html && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Preview</p>
              <SafeHtmlPreview html={html} />
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Annuller
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}{" "}
              Opret kladde
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : !broadcasts?.data?.length ? (
        <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
          <Mail className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 text-gray-500">
            Ingen broadcasts endnu. Opret din foerste broadcast ovenfor.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {broadcasts.data.map(
            (bc: {
              id: string;
              name: string;
              status: string;
              created_at: string;
            }) => (
              <div
                key={bc.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">{bc.name}</p>
                    <p className="text-sm text-gray-500">
                      {new Date(bc.created_at).toLocaleDateString("da-DK")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${bc.status === "sent" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}
                  >
                    {bc.status === "sent" ? "Sendt" : "Kladde"}
                  </span>
                  {bc.status !== "sent" &&
                    (confirmSendId === bc.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-amber-600">
                          <AlertCircle className="inline h-4 w-4 mr-1" />
                          Skriv navnet for at bekræfte:
                        </span>
                        <input
                          type="text"
                          value={confirmSendName}
                          onChange={(e) => setConfirmSendName(e.target.value)}
                          placeholder={bc.name}
                          className="rounded border border-gray-300 px-2 py-1 text-xs"
                          aria-label="Bekræft broadcast-navn"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            sendMutation.mutate({
                              id: bc.id,
                              confirmName: confirmSendName,
                            })
                          }
                          disabled={
                            sendMutation.isPending ||
                            confirmSendName !== bc.name
                          }
                          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          Bekræft send
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmSendId(null);
                            setConfirmSendName("");
                          }}
                          className="rounded bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-300"
                        >
                          Annullér
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmSendId(bc.id);
                          setConfirmSendName("");
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-green-600 px-3 py-1.5 text-xs font-medium text-green-600 hover:bg-green-50"
                      >
                        <Send className="h-3 w-3" /> Send
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate({ id: bc.id })}
                    disabled={removeMutation.isPending}
                    className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
