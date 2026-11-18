"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/Modal";
import { toIntlLocale } from "@/i18n/format-locale";
import { isDraftInvoiceNumber } from "@/lib/invoices/draft-number";
import { trpc } from "@/providers/trpc-provider";

export interface ReviewedInvoice {
  total: number;
  currency: string;
}

export function SendInvoiceDialog({
  invoiceId,
  onClose,
  onSend,
  recipient,
  onRecipientChange,
  provider,
  disabled = false,
}: {
  invoiceId: string | null;
  onClose: () => void;
  onSend: (email: string, invoice: ReviewedInvoice) => Promise<void>;
  recipient?: string;
  onRecipientChange?: (email: string) => void;
  disabled?: boolean;
  provider?: { name: string; paymentTermsDays: number };
}) {
  const t = useTranslations("invoices");
  const pdf = useTranslations("pdf");
  const locale = toIntlLocale(useLocale());
  const recipientId = useId();
  const sending = useRef(false);
  const [isSending, setIsSending] = useState(false);
  const close = useCallback(() => {
    if (!sending.current) onClose();
  }, [onClose]);
  const { data, isError, isFetching } = trpc.invoices.sendPreview.useQuery(
    { id: invoiceId ?? "", paymentTermsDays: provider?.paymentTermsDays },
    { enabled: invoiceId !== null, staleTime: 0 },
  );
  const email = (recipient ?? data?.email ?? "").trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const canSend = Boolean(
    !disabled &&
      data &&
      Number.isFinite(data.total) &&
      !isError &&
      !isFetching &&
      validEmail,
  );
  const dueDate = data?.dueDate;
  const date = dueDate
    ? new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Europe/Copenhagen",
      }).format(new Date(dueDate))
    : pdf("notSpecified");

  return (
    <ConfirmDialog
      isOpen={invoiceId !== null}
      onClose={close}
      onConfirm={async () => {
        if (!data || !canSend || sending.current) return;
        sending.current = true;
        setIsSending(true);
        try {
          await onSend(email, { total: data.total, currency: data.currency });
        } finally {
          sending.current = false;
          setIsSending(false);
        }
      }}
      title={t(
        data?.status && data.status !== "draft" && !provider
          ? "list.reminderTitle"
          : "sendConfirmation.title",
      )}
      confirmLabel={
        email
          ? t("sendConfirmation.sendTo", { email })
          : t("sendConfirmation.title")
      }
      confirmDisabled={!canSend}
      isLoading={isSending}
    >
      {data && !isError ? (
        <div className="space-y-3 break-words text-sm text-gray-700 dark:text-gray-300">
          <dl className="space-y-2">
            <div>
              <dt className="font-medium">{t("detail.invoiceNumber")}</dt>
              <dd>{data.invoiceNumber}</dd>
              {isDraftInvoiceNumber(data.invoiceNumber) && (
                <dd>{t("sendConfirmation.draftNumber")}</dd>
              )}
            </div>
            <div>
              <dt className="font-medium">{t("detail.client")}</dt>
              <dd>{data.clientName}</dd>
            </div>
            <div>
              <dt className="font-medium">
                {onRecipientChange ? (
                  <label htmlFor={recipientId}>{t("detail.recipient")}</label>
                ) : (
                  t("detail.recipient")
                )}
              </dt>
              <dd>
                {onRecipientChange ? (
                  <input
                    id={recipientId}
                    type="email"
                    value={recipient ?? ""}
                    onChange={(event) => onRecipientChange(event.target.value)}
                    disabled={isSending}
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-900"
                  />
                ) : (
                  email || t("exportCommon.noEmail")
                )}
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t("sendConfirmation.total")}</dt>
              <dd>
                {new Intl.NumberFormat(locale, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }).format(data.total)}{" "}
                {data.currency}
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t("detail.dueDate")}</dt>
              <dd>{date}</dd>
            </div>
          </dl>
          {provider && (
            <p>{t("sendConfirmation.provider", { provider: provider.name })}</p>
          )}
        </div>
      ) : (
        t(isError ? "list.sendFailed" : "sendConfirmation.loading")
      )}
    </ConfirmDialog>
  );
}
