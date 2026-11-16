"use client";

import { ChevronLeft, ChevronRight, RotateCcw, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { trpc } from "@/providers/trpc-provider";

export function WebhookLogs() {
  const [webhookPage, setWebhookPage] = useState(1);
  const [webhookStatusFilter, setWebhookStatusFilter] = useState<
    "all" | "success" | "failed"
  >("all");
  const [webhookEventFilter, setWebhookEventFilter] = useState("");
  const [expandedWebhook, setExpandedWebhook] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: webhookDeliveries, isLoading } =
    trpc.admin.listWebhookDeliveries.useQuery({ page: webhookPage });

  const replayWebhookMutation = trpc.admin.replayWebhook.useMutation({
    onSuccess: () => {
      toast.success("Webhook genafspillet");
      utils.admin.listWebhookDeliveries.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={webhookStatusFilter}
          onChange={(e) =>
            setWebhookStatusFilter(
              e.target.value as "all" | "success" | "failed",
            )
          }
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">Alle statuser</option>
          <option value="success">Succesfulde</option>
          <option value="failed">Fejlede</option>
        </select>
        <input
          type="text"
          value={webhookEventFilter}
          onChange={(e) => setWebhookEventFilter(e.target.value)}
          placeholder="Filtrer efter event type..."
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <InlineSpinner className="h-8 w-8" />
        </div>
      ) : webhookDeliveries?.data && webhookDeliveries.data.length > 0 ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 font-medium text-gray-500">Event</th>
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Svarkode
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Tidspunkt
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-500">
                    Handlinger
                  </th>
                </tr>
              </thead>
              <tbody>
                {webhookDeliveries.data
                  .filter((d) => {
                    if (
                      webhookStatusFilter === "success" &&
                      d.status !== "success"
                    )
                      return false;
                    if (
                      webhookStatusFilter === "failed" &&
                      d.status === "success"
                    )
                      return false;
                    if (
                      webhookEventFilter &&
                      !d.event
                        .toLowerCase()
                        .includes(webhookEventFilter.toLowerCase())
                    )
                      return false;
                    return true;
                  })
                  .map((delivery) => (
                    <tr
                      key={delivery.uuid}
                      className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                      onClick={() =>
                        setExpandedWebhook(
                          expandedWebhook === delivery.uuid
                            ? null
                            : delivery.uuid,
                        )
                      }
                    >
                      <td className="px-4 py-2 font-mono text-xs text-gray-900">
                        {delivery.event}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            delivery.status === "success"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {delivery.status === "success" ? "Success" : "Fejlet"}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">
                        {delivery.response_code ?? "--"}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-600">
                        {new Date(delivery.created_at).toLocaleString("da-DK")}
                      </td>
                      <td className="px-4 py-2">
                        {delivery.status !== "success" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              replayWebhookMutation.mutate({
                                uuid: delivery.uuid,
                              });
                            }}
                            disabled={replayWebhookMutation.isPending}
                            className="inline-flex items-center gap-1 rounded-md bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-200 disabled:opacity-50"
                          >
                            <RotateCcw className="h-3 w-3" /> Genafspil
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {expandedWebhook &&
            (() => {
              const d = webhookDeliveries.data.find(
                (w) => w.uuid === expandedWebhook,
              );
              if (!d) return null;
              return (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-gray-900">
                    Detaljer
                  </h3>
                  <div className="space-y-1 text-xs">
                    <div className="grid grid-cols-[120px_1fr] gap-2">
                      <span className="font-medium text-gray-500">UUID:</span>
                      <span className="font-mono text-gray-900">{d.uuid}</span>
                      <span className="font-medium text-gray-500">Event:</span>
                      <span className="font-mono text-gray-900">{d.event}</span>
                      <span className="font-medium text-gray-500">URL:</span>
                      <span className="break-all font-mono text-gray-900">
                        {d.url}
                      </span>
                      <span className="font-medium text-gray-500">
                        Oprettet:
                      </span>
                      <span className="text-gray-900">
                        {new Date(d.created_at).toLocaleString("da-DK")}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">Side {webhookPage}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setWebhookPage((p) => Math.max(1, p - 1))}
                disabled={webhookPage <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" /> Forrige
              </button>
              <button
                type="button"
                onClick={() => setWebhookPage((p) => p + 1)}
                disabled={webhookDeliveries.data.length < 20}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
              >
                Naeste <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="py-12 text-center">
          <Webhook className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-2 text-gray-500">Ingen webhook-leveringer fundet</p>
        </div>
      )}
    </div>
  );
}
