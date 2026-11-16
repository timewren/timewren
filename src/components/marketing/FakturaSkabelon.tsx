"use client";

import { Plus, Printer, Trash2 } from "lucide-react";
import { useState } from "react";

interface LineItem {
  id: number;
  description: string;
  hours: number;
  rate: number;
}

let nextId = 1;

function createLineItem(): LineItem {
  return { id: nextId++, description: "", hours: 0, rate: 0 };
}

export function FakturaSkabelon() {
  const [companyName, setCompanyName] = useState("Dit Firma ApS");
  const [companyAddress, setCompanyAddress] = useState(
    "Firmavej 1, 2100 København",
  );
  const [companyCVR, setCompanyCVR] = useState("DK12345678");
  const [clientName, setClientName] = useState("Kundens Firma A/S");
  const [clientAddress, setClientAddress] = useState(
    "Kundevej 42, 8000 Aarhus",
  );
  const [invoiceNumber, setInvoiceNumber] = useState("2026-001");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
  );
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: nextId++, description: "Webudvikling", hours: 10, rate: 850 },
    { id: nextId++, description: "Design", hours: 5, rate: 750 },
  ]);

  const addLine = () => setLineItems((prev) => [...prev, createLineItem()]);
  const removeLine = (id: number) =>
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  const updateLine = (
    id: number,
    field: keyof LineItem,
    value: string | number,
  ) =>
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );

  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.hours * item.rate,
    0,
  );
  const moms = subtotal * 0.25;
  const total = subtotal + moms;

  const formatDKK = (n: number) =>
    n.toLocaleString("da-DK", {
      style: "currency",
      currency: "DKK",
      maximumFractionDigits: 2,
    });

  const formatDateDK = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  };

  const handlePrint = () => window.print();

  return (
    <div className="mx-auto max-w-4xl">
      {/* Edit mode - hidden when printing */}
      <div className="mb-8 print:hidden">
        <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
          <h3 className="mb-6 text-lg font-semibold text-slate-900">
            Udfyld faktura
          </h3>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Sender */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                Afsender (dig)
              </h4>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Firmanavn"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <input
                type="text"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="Adresse"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <input
                type="text"
                value={companyCVR}
                onChange={(e) => setCompanyCVR(e.target.value)}
                placeholder="CVR-nummer"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {/* Recipient */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                Modtager (kunden)
              </h4>
              <input
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Kundens firmanavn"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
              <input
                type="text"
                value={clientAddress}
                onChange={(e) => setClientAddress(e.target.value)}
                placeholder="Kundens adresse"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="fk-nr"
                className="mb-1 block text-xs font-medium text-slate-500"
              >
                Fakturanr.
              </label>
              <input
                id="fk-nr"
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label
                htmlFor="fk-date"
                className="mb-1 block text-xs font-medium text-slate-500"
              >
                Fakturadato
              </label>
              <input
                id="fk-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
            <div>
              <label
                htmlFor="fk-due"
                className="mb-1 block text-xs font-medium text-slate-500"
              >
                Betalingsfrist
              </label>
              <input
                id="fk-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          {/* Line items editor */}
          <div className="mt-6">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Linjer
            </h4>
            <div className="space-y-2">
              {lineItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) =>
                      updateLine(item.id, "description", e.target.value)
                    }
                    placeholder="Beskrivelse"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <input
                    type="number"
                    value={item.hours}
                    onChange={(e) =>
                      updateLine(item.id, "hours", Number(e.target.value))
                    }
                    placeholder="Timer"
                    className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <input
                    type="number"
                    value={item.rate}
                    onChange={(e) =>
                      updateLine(item.id, "rate", Number(e.target.value))
                    }
                    placeholder="Sats"
                    className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button
                    type="button"
                    onClick={() => removeLine(item.id)}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    aria-label="Fjern linje"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLine}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-600"
            >
              <Plus className="h-4 w-4" />
              Tilføj linje
            </button>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white transition-all hover:bg-brand-700 hover:shadow-lg"
            >
              <Printer className="h-5 w-5" />
              Print / Gem som PDF
            </button>
          </div>
        </div>
      </div>

      {/* Invoice preview - always visible, and the only thing printed */}
      <div className="rounded-2xl border border-slate-200/60 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none sm:p-12">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{companyName}</h2>
            <p className="mt-1 text-sm text-slate-500">{companyAddress}</p>
            <p className="text-sm text-slate-500">CVR: {companyCVR}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-brand-600">FAKTURA</p>
            <p className="mt-1 text-sm text-slate-500">Nr. {invoiceNumber}</p>
          </div>
        </div>

        {/* Client + dates */}
        <div className="mb-8 grid grid-cols-2 gap-8 border-t border-slate-200 pt-6">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Faktureres til
            </p>
            <p className="font-semibold text-slate-900">{clientName}</p>
            <p className="text-sm text-slate-600">{clientAddress}</p>
          </div>
          <div className="text-right">
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-slate-500">Fakturadato:</span>{" "}
                <span className="font-medium text-slate-900">
                  {formatDateDK(invoiceDate)}
                </span>
              </p>
              <p>
                <span className="text-slate-500">Betalingsfrist:</span>{" "}
                <span className="font-medium text-slate-900">
                  {formatDateDK(dueDate)}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Table */}
        <table className="mb-8 w-full">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="pb-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                Beskrivelse
              </th>
              <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Timer
              </th>
              <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Sats
              </th>
              <th className="pb-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                Beløb
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lineItems.map((item) => (
              <tr key={item.id}>
                <td className="py-3 text-sm text-slate-900">
                  {item.description || "–"}
                </td>
                <td className="py-3 text-right text-sm text-slate-600">
                  {item.hours.toLocaleString("da-DK")}
                </td>
                <td className="py-3 text-right text-sm text-slate-600">
                  {formatDKK(item.rate)}
                </td>
                <td className="py-3 text-right text-sm font-medium text-slate-900">
                  {formatDKK(item.hours * item.rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="border-t-2 border-slate-200 pt-4">
          <div className="ml-auto max-w-xs space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-slate-900">{formatDKK(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Moms (25%)</span>
              <span className="text-slate-900">{formatDKK(moms)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold">
              <span className="text-slate-900">Total</span>
              <span className="text-slate-900">{formatDKK(total)}</span>
            </div>
          </div>
        </div>

        {/* Payment info */}
        <div className="mt-8 rounded-lg bg-slate-50 p-4 text-sm text-slate-600 print:bg-slate-100">
          <p className="font-semibold text-slate-700">Betalingsinformation</p>
          <p>
            Betal venligst inden {formatDateDK(dueDate)} til reg.nr. XXXX konto
            XXXXXXXXXX.
          </p>
          <p>Angiv fakturanummer {invoiceNumber} som reference.</p>
        </div>
      </div>
    </div>
  );
}
