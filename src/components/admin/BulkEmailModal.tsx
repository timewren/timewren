"use client";

import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/Modal";
import { trpc } from "@/providers/trpc-provider";

interface BulkEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  userIds: string[];
  userCount: number;
  onSuccess: () => void;
}

export function BulkEmailModal({
  isOpen,
  onClose,
  userIds,
  userCount,
  onSuccess,
}: BulkEmailModalProps) {
  const fid = useId();
  const t = useTranslations("adminUsers");
  const [mode, setMode] = useState<"fritekst" | "skabelon">("fritekst");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const { data: templates } =
    trpc.admin.supportTemplates.listTemplates.useQuery(undefined, {
      enabled: isOpen && mode === "skabelon",
    });

  const sendMutation = trpc.admin.bulkEmail.useMutation({
    onSuccess: (result) => {
      toast.success(
        t("bulkEmail.result", {
          sent: result.sent,
          failed: result.failed,
          total: result.total,
        }),
      );
      setSubject("");
      setBody("");
      setConfirming(false);
      onSuccess();
      onClose();
    },
    onError: (error) => {
      toast.error(error.message);
      setConfirming(false);
    },
  });

  const handleSelectTemplate = (templateId: string) => {
    const template = templates?.find(
      (tpl: { id: string }) => tpl.id === templateId,
    );
    if (template) {
      setSubject(template.subject ?? template.name ?? "");
      setBody(template.body ?? "");
    }
  };

  const handleSend = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    sendMutation.mutate({ userIds, subject, body });
  };

  const handleClose = () => {
    setConfirming(false);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t("bulkEmail.title")}
      size="lg"
    >
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode("fritekst")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "fritekst"
                ? "bg-tt-gran text-tt-paa-gran"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {t("bulkEmail.modeFreeText")}
          </button>
          <button
            type="button"
            onClick={() => setMode("skabelon")}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "skabelon"
                ? "bg-tt-gran text-tt-paa-gran"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {t("bulkEmail.modeTemplate")}
          </button>
        </div>

        {/* Template selector */}
        {mode === "skabelon" && (
          <div>
            <label
              htmlFor={`${fid}-f1`}
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t("bulkEmail.chooseTemplate")}
            </label>
            <select
              id={`${fid}-f1`}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
              defaultValue=""
            >
              <option value="" disabled>
                {t("bulkEmail.chooseTemplatePlaceholder")}
              </option>
              {templates?.map((tpl: { id: string; name: string }) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Subject */}
        <div>
          <label
            htmlFor={`${fid}-f2`}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("bulkEmail.subject")}
          </label>
          <input
            id={`${fid}-f2`}
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("bulkEmail.subjectPlaceholder")}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400"
          />
        </div>

        {/* Body */}
        <div>
          <label
            htmlFor={`${fid}-f3`}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t("bulkEmail.body")}
          </label>
          <textarea
            id={`${fid}-f3`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder={t("bulkEmail.bodyPlaceholder")}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 resize-y"
          />
        </div>

        {/* Confirmation */}
        {confirming && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t("bulkEmail.confirmTitle", { count: userCount })}
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              {t("bulkEmail.confirmHint")}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t("bulkEmail.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!subject || !body || sendMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Mail className="h-4 w-4" />
            {sendMutation.isPending
              ? t("bulkEmail.sending")
              : confirming
                ? t("bulkEmail.confirmSend", { count: userCount })
                : t("bulkEmail.send", { count: userCount })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
