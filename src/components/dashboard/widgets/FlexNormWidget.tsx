"use client";

import { Scale } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toIntlLocale } from "@/i18n/format-locale";
import { currentSyncLocale } from "@/i18n/sync-text";
import { trpc } from "@/providers/trpc-provider";

/** Ét decimal med sprogets decimaltegn (dansk komma som standard). */
function oneDecimal(
  value: number,
  locale: string = currentSyncLocale(),
): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/** "+1,5", "−0,3", "0,0" — sprogets decimaltegn og rigtigt minustegn. */
export function formatSignedHours(
  value: number,
  locale: string = currentSyncLocale(),
): string {
  const abs = oneDecimal(Math.abs(value), locale);
  if (value > 0.04) return `+${abs}`;
  if (value < -0.04) return `−${abs}`;
  return oneDecimal(0, locale);
}

function toneClass(value: number): string {
  if (value > 0.04) return "text-green-700 dark:text-green-400";
  if (value < -0.04) return "text-red-700 dark:text-red-400";
  return "text-gray-900 dark:text-gray-100";
}

/**
 * Flexsaldo i normperioden (#507): saldo inkl. overført, og flex i
 * indeværende uge, måned og periode. Selvstændig (henter selv data), så den
 * kan bruges både som dashboard-widget og på Hjem (#743).
 */
export function FlexNormWidget({
  userId,
  showLink = true,
}: {
  /** Leder/HR: vis en medarbejders saldo (scope tjekkes på serveren) */
  userId?: string;
  showLink?: boolean;
}) {
  const t = useTranslations("dashboard.widgets.flexNorm");
  const locale = useLocale();
  const { data, isLoading, isError } =
    trpc.enterprise.getFlexNormBalance.useQuery(
      userId ? { userId } : undefined,
    );

  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scale
            className="h-4 w-4 text-gray-500 dark:text-gray-400"
            aria-hidden
          />
          <span className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {t("title")}
          </span>
        </div>
        {data && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {data.current.label}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-8 w-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-4 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ) : isError ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("loadFailed")}
        </p>
      ) : !data ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("noProfile")}
        </p>
      ) : (
        <>
          <p
            className={`text-2xl font-bold tabular-nums sm:text-3xl ${toneClass(data.current.balance)}`}
          >
            {formatSignedHours(data.current.balance, locale)}
            <span className="ml-1 text-sm font-normal text-gray-500 dark:text-gray-400">
              {t("unit")}
            </span>
          </p>
          {data.current.carryIn !== 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("carryIn", {
                value: formatSignedHours(data.current.carryIn, locale),
              })}
            </p>
          )}
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: t("week"), value: data.week.flex },
              { label: t("month"), value: data.month.flex },
              { label: t("period"), value: data.current.totals.flex },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-md bg-gray-50 px-2 py-1.5 dark:bg-gray-800/60"
              >
                <dt className="text-xs text-gray-500 dark:text-gray-400">
                  {item.label}
                </dt>
                <dd
                  className={`text-sm font-semibold tabular-nums ${toneClass(item.value)}`}
                >
                  {formatSignedHours(item.value, locale)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("summary", {
              registered: oneDecimal(data.current.totals.registered, locale),
              net: oneDecimal(data.current.totals.net, locale),
              periodNet: oneDecimal(data.current.periodNet, locale),
            })}
          </p>
          {showLink && (
            <Link
              href="/dashboard/enterprise/flex"
              className="mt-auto pt-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
            >
              {t("seeAccount")}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
