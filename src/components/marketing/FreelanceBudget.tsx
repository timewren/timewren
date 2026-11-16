"use client";

import { Download, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

type IncomeSource = { id: string; name: string; amount: number };
type CostItem = { id: string; name: string; amount: number };

let nextId = 1;
const uid = () => `item-${nextId++}`;

const defaultIncome: IncomeSource[] = [
  { id: uid(), name: "Kunde A", amount: 25000 },
  { id: uid(), name: "Kunde B", amount: 15000 },
];

const defaultFixed: CostItem[] = [
  { id: uid(), name: "Husleje / kontor", amount: 5000 },
  { id: uid(), name: "Forsikring", amount: 800 },
  { id: uid(), name: "Software / abonnementer", amount: 500 },
  { id: uid(), name: "Telefon / internet", amount: 400 },
];

const defaultVariable: CostItem[] = [
  { id: uid(), name: "Transport", amount: 1000 },
  { id: uid(), name: "Forplejning", amount: 500 },
];

const TAX_RATE = 0.4;

function formatDKK(n: number) {
  return n.toLocaleString("da-DK", {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function ItemList({
  title,
  items,
  setItems,
  nameLabel,
}: {
  title: string;
  items: CostItem[];
  setItems: (items: CostItem[]) => void;
  nameLabel: string;
}) {
  const addItem = () =>
    setItems([...items, { id: uid(), name: "", amount: 0 }]);
  const removeItem = (id: string) => setItems(items.filter((i) => i.id !== id));
  const updateItem = (id: string, field: "name" | "amount", value: string) => {
    setItems(
      items.map((i) =>
        i.id === id
          ? {
              ...i,
              [field]: field === "amount" ? Number(value) || 0 : value,
            }
          : i,
      ),
    );
  };

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <input
              type="text"
              value={item.name}
              onChange={(e) => updateItem(item.id, "name", e.target.value)}
              placeholder={nameLabel}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <div className="relative">
              <input
                type="number"
                value={item.amount || ""}
                onChange={(e) => updateItem(item.id, "amount", e.target.value)}
                placeholder="0"
                className="w-28 rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-right text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                kr
              </span>
            </div>
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              aria-label="Fjern"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addItem}
        className="mt-2 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-brand-600 transition-colors hover:bg-brand-50"
      >
        <Plus className="h-4 w-4" /> Tilføj
      </button>
    </div>
  );
}

export function FreelanceBudget() {
  const [income, setIncome] = useState<IncomeSource[]>(defaultIncome);
  const [fixedCosts, setFixedCosts] = useState<CostItem[]>(defaultFixed);
  const [variableCosts, setVariableCosts] =
    useState<CostItem[]>(defaultVariable);
  const [savingsGoal, setSavingsGoal] = useState(10);

  const totalIncome = income.reduce((s, i) => s + i.amount, 0);
  const totalFixed = fixedCosts.reduce((s, i) => s + i.amount, 0);
  const totalVariable = variableCosts.reduce((s, i) => s + i.amount, 0);
  const totalCosts = totalFixed + totalVariable;
  const profit = totalIncome - totalCosts;
  const taxEstimate = Math.max(0, profit * TAX_RATE);
  const afterTax = profit - taxEstimate;
  const savingsAmount = Math.max(0, (totalIncome * savingsGoal) / 100);
  const disposable = afterTax - savingsAmount;

  const exportCSV = useCallback(() => {
    const lines = ["Type;Navn;Beloeb (kr)"];
    for (const i of income) lines.push(`Indkomst;${i.name};${i.amount}`);
    for (const c of fixedCosts) lines.push(`Fast udgift;${c.name};${c.amount}`);
    for (const c of variableCosts)
      lines.push(`Variabel udgift;${c.name};${c.amount}`);
    lines.push("");
    lines.push(`Resultat;Total indkomst;${totalIncome}`);
    lines.push(`Resultat;Total udgifter;${totalCosts}`);
    lines.push(`Resultat;Overskud foer skat;${profit}`);
    lines.push(`Resultat;Estimeret skat (40%);${taxEstimate}`);
    lines.push(`Resultat;Overskud efter skat;${afterTax}`);

    const blob = new Blob([`﻿${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "freelance-budget.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [
    income,
    fixedCosts,
    variableCosts,
    totalIncome,
    totalCosts,
    profit,
    taxEstimate,
    afterTax,
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Input columns */}
        <div className="space-y-6 lg:col-span-3">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <ItemList
              title="Indkomst (pr. måned)"
              items={income}
              setItems={setIncome}
              nameLabel="Kunde / kilde"
            />
          </div>

          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <ItemList
              title="Faste udgifter"
              items={fixedCosts}
              setItems={setFixedCosts}
              nameLabel="Udgift"
            />
          </div>

          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <ItemList
              title="Variable udgifter"
              items={variableCosts}
              setItems={setVariableCosts}
              nameLabel="Udgift"
            />
          </div>
        </div>

        {/* Results column */}
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Overblik
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Total indkomst</span>
                <span className="font-semibold text-green-700">
                  {formatDKK(totalIncome)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">Faste udgifter</span>
                <span className="font-semibold text-slate-900">
                  {formatDKK(totalFixed)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  Variable udgifter
                </span>
                <span className="font-semibold text-slate-900">
                  {formatDKK(totalVariable)}
                </span>
              </div>
              <div className="border-t border-slate-100 pt-3" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  Overskud
                </span>
                <span
                  className={`text-lg font-bold ${profit >= 0 ? "text-green-700" : "text-red-600"}`}
                >
                  {formatDKK(profit)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  Estimeret skat (~40%)
                </span>
                <span className="font-semibold text-orange-600">
                  -{formatDKK(taxEstimate)}
                </span>
              </div>
              <div className="border-t border-slate-100 pt-3" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  Efter skat
                </span>
                <span
                  className={`text-lg font-bold ${afterTax >= 0 ? "text-slate-900" : "text-red-600"}`}
                >
                  {formatDKK(afterTax)}
                </span>
              </div>
            </div>
          </div>

          {/* Savings goal */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Opsparingsmål
            </h3>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={50}
                value={savingsGoal}
                onChange={(e) => setSavingsGoal(Number(e.target.value))}
                className="flex-1 accent-brand-600"
              />
              <span className="w-12 text-right text-sm font-semibold text-slate-900">
                {savingsGoal}%
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Af indkomst = {formatDKK(savingsAmount)}/md
            </p>
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-sm text-slate-600">Til rådighed</span>
              <span
                className={`font-bold ${disposable >= 0 ? "text-slate-900" : "text-red-600"}`}
              >
                {formatDKK(disposable)}
              </span>
            </div>
          </div>

          {/* Visualization */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Fordeling
            </h3>
            {totalIncome > 0 ? (
              <div className="space-y-2">
                {[
                  {
                    label: "Udgifter",
                    value: totalCosts,
                    color: "bg-slate-400",
                  },
                  { label: "Skat", value: taxEstimate, color: "bg-orange-400" },
                  {
                    label: "Opsparing",
                    value: savingsAmount,
                    color: "bg-blue-400",
                  },
                  {
                    label: "Til rådighed",
                    value: Math.max(0, disposable),
                    color: "bg-green-500",
                  },
                ].map((bar) => (
                  <div key={bar.label}>
                    <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                      <span>{bar.label}</span>
                      <span>
                        {Math.round((bar.value / totalIncome) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${bar.color} transition-all`}
                        style={{
                          width: `${Math.min(100, (bar.value / totalIncome) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Tilføj indkomst for at se fordeling.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={exportCSV}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <Download className="h-4 w-4" /> Eksportér som CSV
          </button>
        </div>
      </div>
    </div>
  );
}
