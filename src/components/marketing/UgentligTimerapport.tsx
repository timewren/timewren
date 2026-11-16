"use client";

import { Copy, Plus, Printer, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { isoWeekNumber } from "@/lib/enterprise/week";

const WEEKDAYS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"] as const;

interface ProjectRow {
  id: number;
  name: string;
  hours: number[];
}

let nextRowId = 1;

function createRow(): ProjectRow {
  return { id: nextRowId++, name: "", hours: [0, 0, 0, 0, 0, 0, 0] };
}

function rowTotal(row: ProjectRow) {
  return row.hours.reduce((s, h) => s + h, 0);
}

function formatHours(h: number) {
  return h % 1 === 0
    ? h.toString()
    : h.toLocaleString("da-DK", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      });
}

export function UgentligTimerapport() {
  const [employeeName, setEmployeeName] = useState("Dit navn");
  // Siden er statisk bygget, så ugenummeret sættes først efter mount: ellers
  // er serverens uge build-dagens, og hydreringen fejler (React #418).
  // ISO-uge (mandag-søndag), som danske ugenumre følger.
  const [weekNumber, setWeekNumber] = useState<number | null>(null);
  useEffect(() => {
    setWeekNumber((current) => current ?? isoWeekNumber(new Date()));
  }, []);
  const [rows, setRows] = useState<ProjectRow[]>([
    { id: nextRowId++, name: "Projekt A", hours: [8, 7.5, 8, 8, 7, 0, 0] },
    { id: nextRowId++, name: "Projekt B", hours: [0, 0.5, 0, 0, 1, 0, 0] },
  ]);

  const addRow = () => setRows((prev) => [...prev, createRow()]);
  const removeRow = (id: number) =>
    setRows((prev) => prev.filter((r) => r.id !== id));

  const updateName = (id: number, name: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));

  const updateHours = (id: number, dayIndex: number, value: number) =>
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? { ...r, hours: r.hours.map((h, i) => (i === dayIndex ? value : h)) }
          : r,
      ),
    );

  const dayTotals = WEEKDAYS.map((_, i) =>
    rows.reduce((s, r) => s + r.hours[i], 0),
  );

  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);

  const handleCopy = useCallback(() => {
    const header = ["Projekt", ...WEEKDAYS, "Total"].join("\t");
    const lines = rows.map((r) =>
      [r.name, ...r.hours.map(formatHours), formatHours(rowTotal(r))].join(
        "\t",
      ),
    );
    const totalsLine = [
      "Total",
      ...dayTotals.map(formatHours),
      formatHours(grandTotal),
    ].join("\t");
    const text = [
      `Timerapport, uge ${weekNumber ?? ""}, ${employeeName}`,
      "",
      header,
      ...lines,
      totalsLine,
    ].join("\n");
    navigator.clipboard.writeText(text);
  }, [rows, dayTotals, grandTotal, weekNumber, employeeName]);

  return (
    <div className="mx-auto max-w-5xl">
      {/* Meta fields */}
      <div className="mb-6 grid gap-4 print:hidden sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <label
            htmlFor="ut-name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Navn
          </label>
          <input
            id="ut-name"
            type="text"
            value={employeeName}
            onChange={(e) => setEmployeeName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        <div className="rounded-2xl border border-slate-200/60 bg-white p-4 shadow-sm">
          <label
            htmlFor="ut-week"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Ugenummer
          </label>
          <input
            id="ut-week"
            type="number"
            value={weekNumber ?? ""}
            onChange={(e) => setWeekNumber(Number(e.target.value))}
            min={1}
            max={53}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </div>

      {/* Timesheet */}
      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm">
        {/* Print header */}
        <div className="hidden border-b border-slate-200 p-6 print:block">
          <h2 className="text-xl font-bold text-slate-900">
            Timerapport, uge {weekNumber ?? ""}
          </h2>
          <p className="text-sm text-slate-600">{employeeName}</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Projekt
                </th>
                {WEEKDAYS.map((day) => (
                  <th
                    key={day}
                    className="px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500"
                  >
                    {day}
                  </th>
                ))}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Total
                </th>
                <th className="w-10 px-2 py-3 print:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.id} className="group">
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateName(row.id, e.target.value)}
                      placeholder="Projektnavn"
                      className="w-full rounded border-0 bg-transparent px-1 py-1 text-sm text-slate-900 focus:bg-brand-50 focus:outline-none print:bg-transparent"
                    />
                  </td>
                  {row.hours.map((h, i) => (
                    <td key={WEEKDAYS[i]} className="px-1 py-2">
                      <input
                        type="number"
                        value={h || ""}
                        onChange={(e) =>
                          updateHours(
                            row.id,
                            i,
                            Math.max(0, Number(e.target.value)),
                          )
                        }
                        min={0}
                        max={24}
                        step={0.25}
                        className="w-full rounded border-0 bg-transparent px-1 py-1 text-center tabular-nums text-sm text-slate-900 focus:bg-brand-50 focus:outline-none print:bg-transparent"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right tabular-nums text-sm font-semibold text-slate-900">
                    {formatHours(rowTotal(row))}
                  </td>
                  <td className="px-2 py-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="rounded p-1 text-slate-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                      aria-label="Fjern række"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/50 font-semibold">
                <td className="px-4 py-3 text-sm text-slate-700">Total</td>
                {dayTotals.map((t, i) => (
                  <td
                    key={WEEKDAYS[i]}
                    className="px-2 py-3 text-center tabular-nums text-sm text-slate-700"
                  >
                    {formatHours(t)}
                  </td>
                ))}
                <td className="px-4 py-3 text-right tabular-nums text-sm text-brand-700">
                  {formatHours(grandTotal)}
                </td>
                <td className="print:hidden" />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-slate-200 p-4 print:hidden">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600"
          >
            <Plus className="h-4 w-4" />
            Tilføj projekt
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" />
              Kopiér
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-brand-700"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
