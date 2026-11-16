"use client";

import { CheckCircle2, Download, FileText } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { Button } from "@/components/ui";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatDanishDateTime } from "@/lib/enterprise/dpa/format";
import { trpc } from "@/providers/trpc-provider";

/**
 * Databehandleraftalen i indstillingerne, for alle planer. Bruges både under
 * GDPR & data og under Enterprise > Login & domæner. Kun ejere og
 * administratorer ser kortet (status-forespørgslen afvises for andre).
 */

export const DPA_LINK_BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-lg border border-tt-kant bg-tt-flade px-3 py-1.5 text-sm font-medium text-tt-blaek hover:bg-tt-streg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tt-fokus sm:min-h-8";

export function DpaCard() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("settingsDpa");
  const locale = useLocale();
  // Dansk tekst bevares i den kendte danske form; øvrige sprog følger Intl
  const formatDateTime = (d: Date) =>
    locale === "da"
      ? formatDanishDateTime(d)
      : new Intl.DateTimeFormat(toIntlLocale(locale), {
          dateStyle: "long",
          timeStyle: "short",
          timeZone: "Europe/Copenhagen",
        }).format(d);
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.dpa.status.useQuery(undefined, {
    retry: false,
  });
  const [confirmed, setConfirmed] = useState(false);
  const accept = trpc.dpa.accept.useMutation({
    onSuccess: () => {
      utils.dpa.status.invalidate();
      toast.success(t("accepted"));
    },
    onError: (e) => toast.error(e.message),
  });

  // Medarbejdere og brugere uden organisation ser ikke kortet. Mangler en
  // administrator 2FA, som org'en kræver, vises beskeden i stedet.
  if (error) {
    if (!/totrinsbekræftelse/i.test(error.message)) return null;
    return (
      <section
        id="databehandleraftale"
        className="rounded-xl border border-tt-streg bg-tt-flade-hoej p-6"
      >
        <h2 className="text-base font-semibold text-tt-blaek">{t("title")}</h2>
        <p className="mt-1 text-sm text-tt-graa">{error.message}</p>
      </section>
    );
  }

  return (
    <section
      id="databehandleraftale"
      className="rounded-xl border border-tt-streg bg-tt-flade-hoej p-6"
    >
      <div className="flex items-start gap-3">
        <FileText
          className="mt-0.5 h-5 w-5 shrink-0 text-tt-graa"
          strokeWidth={1.5}
          aria-hidden
        />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-tt-blaek">
            {t("title")}
          </h2>
          <p className="mt-1 text-sm text-tt-graa">
            {data
              ? t("introVersion", {
                  brand: brand.name,
                  version: data.version,
                  date: data.versionDate,
                })
              : t("intro", { brand: brand.name })}
          </p>
        </div>
      </div>

      {isLoading || !data ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-tt-flade" />
      ) : (
        <>
          {data.currentAcceptance ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-tt-streg bg-tt-gran-lys p-3 text-sm text-tt-blaek">
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-tt-gran"
                aria-hidden
              />
              <span>
                {t("acceptedOn", {
                  date: formatDateTime(
                    new Date(data.currentAcceptance.acceptedAt),
                  ),
                  by:
                    data.currentAcceptance.acceptedByName ||
                    data.currentAcceptance.acceptedByEmail,
                })}
              </span>
            </p>
          ) : (
            <p className="mt-4 rounded-lg border border-tt-kant bg-tt-flade p-3 text-sm text-tt-blaek">
              {t("notAccepted", { version: data.version })}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/api/dpa/pdf/udfyldt" className={DPA_LINK_BUTTON} download>
              <Download className="h-4 w-4" aria-hidden />
              {t("downloadPdf")}
            </a>
            <Link href="/databehandleraftale" className={DPA_LINK_BUTTON}>
              <FileText className="h-4 w-4" aria-hidden />
              {t("readAgreement")}
            </Link>
          </div>
          <p className="mt-2 text-xs text-tt-graa">
            {t("pdfNote", {
              withAccept: data.currentAcceptance ? "yes" : "no",
            })}
          </p>

          {!data.currentAcceptance && (
            <div className="mt-4 space-y-3 border-t border-tt-streg pt-4">
              <label className="flex items-start gap-3 text-sm text-tt-blaek">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-tt-gran"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>{t("confirm", { version: data.version })}</span>
              </label>
              <Button
                onClick={() => accept.mutate({ version: data.version })}
                disabled={!confirmed || accept.isPending}
              >
                {accept.isPending ? t("registering") : t("accept")}
              </Button>
            </div>
          )}

          {data.history.length > 0 && (
            <details className="mt-4 text-xs text-tt-graa">
              <summary className="cursor-pointer">
                {t("history", { count: data.history.length })}
              </summary>
              <ul className="mt-2 space-y-1">
                {data.history.map((h) => (
                  <li key={h.id}>
                    {t("historyItem", {
                      version: h.version,
                      date: formatDateTime(new Date(h.acceptedAt)),
                      email: h.acceptedByEmail,
                    })}
                    {h.ipAddress ? t("historyIp", { ip: h.ipAddress }) : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
