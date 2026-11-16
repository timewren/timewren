"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { collectRecords, recordsCSV } from "@/lib/my-records/records";
import { downloadCSV } from "@/lib/utils/csv-export";
import { trpc } from "@/providers/trpc-provider";

export default function MyRecordsPage() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(0);
  const [offset, setOffset] = useState(0);
  const [exporting, setExporting] = useState(false);
  const utils = trpc.useUtils();
  const validYear =
    /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9998;
  const input = {
    year: validYear ? Number(year) : 1900,
    month: month || undefined,
  };
  const { data, isLoading, error, refetch } = trpc.time.myRecords.useQuery(
    {
      ...input,
      offset,
    },
    { enabled: validYear },
  );
  const period = `${year}${month ? `-${String(month).padStart(2, "0")}` : ""}`;

  async function exportRecords(format: "csv" | "pdf") {
    setExporting(true);
    try {
      const entries = await collectRecords((offset) =>
        utils.time.myRecords.fetch({ ...input, offset }),
      );
      if (format === "csv") {
        downloadCSV(recordsCSV(entries), `mine-registreringer-${period}.csv`);
      } else {
        const { recordsPDF } = await import("@/lib/my-records/pdf");
        const url = URL.createObjectURL(await recordsPDF(entries, period));
        const link = document.createElement("a");
        link.href = url;
        link.download = `mine-registreringer-${period}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast.error("Eksporten kunne ikke hentes. Prøv igen.");
    } finally {
      setExporting(false);
    }
  }

  const control =
    "rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100";
  return (
    <div className="space-y-6">
      <PageHeader title="Mine registreringer" />
      <p>
        Her kan du se og hente dine egne registreringer i den aktive
        organisation. Timer vises uden afrunding.
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Vælg et vilkårligt år med gemte registreringer. Læs om opbevaring i{" "}
        <Link href="/databehandleraftale" className="underline">
          databehandleraftalen
        </Link>
        . Din arbejdsgiver er ansvarlig for opbevaringsperioden.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          År
          <input
            type="number"
            min={1900}
            max={9998}
            value={year}
            disabled={exporting}
            className={control}
            onChange={(event) => {
              setYear(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="grid gap-1">
          Måned
          <select
            value={month}
            disabled={exporting}
            className={control}
            onChange={(event) => {
              setMonth(Number(event.target.value));
              setOffset(0);
            }}
          >
            <option value={0}>Hele året</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((monthNumber) => (
              <option key={monthNumber} value={monthNumber}>
                {new Date(2024, monthNumber - 1, 1).toLocaleDateString(
                  "da-DK",
                  {
                    month: "long",
                  },
                )}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={control}
          disabled={!validYear || exporting || isLoading || !!error}
          onClick={() => exportRecords("csv")}
        >
          Hent CSV
        </button>
        <button
          type="button"
          className={control}
          disabled={!validYear || exporting || isLoading || !!error}
          onClick={() => exportRecords("pdf")}
        >
          Hent PDF
        </button>
        {exporting && (
          <p role="status">Henter alle registreringer i perioden…</p>
        )}
      </div>
      {!validYear ? (
        <p role="alert">Angiv et år mellem 1900 og 9998.</p>
      ) : isLoading ? (
        <p role="status">Henter registreringer…</p>
      ) : error ? (
        <div role="alert">
          Registreringerne kunne ikke hentes.{" "}
          <button type="button" className={control} onClick={() => refetch()}>
            Prøv igen
          </button>
        </div>
      ) : !data?.entries.length ? (
        <p>Ingen registreringer i perioden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">
              Dine registreringer for {period}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="p-3">
                  Dato
                </th>
                <th scope="col" className="p-3">
                  Beskrivelse
                </th>
                <th scope="col" className="p-3 text-right">
                  Timer
                </th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr
                  key={entry.id}
                  className="border-t border-gray-200 dark:border-gray-700"
                >
                  <td className="p-3 whitespace-nowrap">
                    {entry.date
                      .toISOString()
                      .slice(0, 10)
                      .split("-")
                      .reverse()
                      .join(".")}
                  </td>
                  <td className="p-3 break-words">{entry.description}</td>
                  <td className="p-3 text-right tabular-nums">
                    {Number(entry.hours).toLocaleString("da-DK")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          className={control}
          disabled={offset === 0 || isLoading}
          onClick={() => setOffset(Math.max(0, offset - 250))}
        >
          Forrige side
        </button>
        <button
          type="button"
          className={control}
          disabled={data?.nextOffset == null || isLoading || !!error}
          onClick={() => setOffset(data?.nextOffset ?? 0)}
        >
          Næste side
        </button>
      </div>
    </div>
  );
}
