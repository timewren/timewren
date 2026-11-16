"use client";

import { Clock, Download, Plus, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type TimeEntry = {
  id: string;
  clientId: string;
  date: string;
  hours: number;
  description: string;
};

type Client = {
  id: string;
  name: string;
};

let nextId = Date.now();
const uid = () => `e-${nextId++}`;

function toLocalDateStr(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const STORAGE_KEY = "timetrack-client-hours";

function loadState(): { clients: Client[]; entries: TimeEntry[] } {
  if (typeof window === "undefined") return { clients: [], entries: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { clients: [], entries: [] };
}

function saveState(clients: Client[], entries: TimeEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients, entries }));
  } catch {}
}

export function ClientHoursTracker() {
  const [clients, setClients] = useState<Client[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  // New entry form
  const [newClientId, setNewClientId] = useState("");
  const [newDate, setNewDate] = useState(toLocalDateStr(new Date()));
  const [newHours, setNewHours] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // New client
  const [newClientName, setNewClientName] = useState("");

  // Load from localStorage
  useEffect(() => {
    const state = loadState();
    setClients(state.clients);
    setEntries(state.entries);
    if (state.clients.length > 0) setNewClientId(state.clients[0].id);
    setLoaded(true);
  }, []);

  // Save on change
  useEffect(() => {
    if (loaded) saveState(clients, entries);
  }, [clients, entries, loaded]);

  const addClient = useCallback(() => {
    const name = newClientName.trim();
    if (!name) return;
    const client: Client = { id: uid(), name };
    setClients((prev) => {
      const next = [...prev, client];
      if (!newClientId) setNewClientId(client.id);
      return next;
    });
    setNewClientName("");
  }, [newClientName, newClientId]);

  const removeClient = useCallback(
    (id: string) => {
      setClients((prev) => prev.filter((c) => c.id !== id));
      setEntries((prev) => prev.filter((e) => e.clientId !== id));
      if (newClientId === id) setNewClientId("");
    },
    [newClientId],
  );

  const addEntry = useCallback(() => {
    if (!newClientId || !newHours) return;
    const entry: TimeEntry = {
      id: uid(),
      clientId: newClientId,
      date: newDate,
      hours: Number.parseFloat(newHours) || 0,
      description: newDescription,
    };
    setEntries((prev) => [entry, ...prev]);
    setNewHours("");
    setNewDescription("");
  }, [newClientId, newDate, newHours, newDescription]);

  const removeEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const getClientName = useCallback(
    (id: string) => clients.find((c) => c.id === id)?.name ?? "Ukendt",
    [clients],
  );

  // Totals per client
  const clientTotals = clients.map((c) => ({
    ...c,
    total: entries
      .filter((e) => e.clientId === c.id)
      .reduce((s, e) => s + e.hours, 0),
  }));

  const grandTotal = entries.reduce((s, e) => s + e.hours, 0);

  const exportCSV = useCallback(() => {
    const lines = ["Dato;Kunde;Timer;Beskrivelse"];
    for (const e of entries) {
      lines.push(
        `${e.date};${getClientName(e.clientId)};${e.hours};${e.description}`,
      );
    }
    lines.push("");
    lines.push(";;");
    lines.push("Kunde;Total timer;");
    for (const c of clientTotals) {
      lines.push(`${c.name};${c.total};`);
    }
    lines.push(`I alt;${grandTotal};`);

    const blob = new Blob([`﻿${lines.join("\n")}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timer-oversigt-${toLocalDateStr(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, clientTotals, grandTotal, getClientName]);

  if (!loaded) {
    return (
      <div className="mx-auto max-w-4xl animate-pulse">
        <div className="h-64 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Add client + log entry */}
        <div className="space-y-6 lg:col-span-2">
          {/* Add client */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Kunder
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newClientName}
                onChange={(e) => setNewClientName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addClient()}
                placeholder="Kundenavn..."
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                type="button"
                onClick={addClient}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                <Plus className="h-4 w-4" /> Tilføj
              </button>
            </div>
            {clients.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {clients.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700"
                  >
                    {c.name}
                    <button
                      type="button"
                      onClick={() => removeClient(c.id)}
                      className="ml-1 text-slate-400 hover:text-red-600"
                      aria-label={`Fjern ${c.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Log entry */}
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              Registrer timer
            </h3>
            {clients.length === 0 ? (
              <p className="text-sm text-slate-400">
                Tilføj en kunde ovenfor for at komme i gang.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <select
                    value={newClientId}
                    onChange={(e) => setNewClientId(e.target.value)}
                    className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:col-span-1"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={newHours}
                    onChange={(e) => setNewHours(e.target.value)}
                    placeholder="Timer"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addEntry()}
                    placeholder="Beskrivelse..."
                    className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 sm:col-span-1"
                  />
                </div>
                <button
                  type="button"
                  onClick={addEntry}
                  className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                >
                  <Plus className="h-4 w-4" /> Tilføj timer
                </button>
              </div>
            )}
          </div>

          {/* Entries list */}
          {entries.length > 0 && (
            <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                  Registreringer ({entries.length})
                </h3>
                <button
                  type="button"
                  onClick={exportCSV}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Download className="h-3 w-3" /> CSV
                </button>
              </div>
              <div className="divide-y divide-slate-100">
                {entries.slice(0, 50).map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">{e.date}</span>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {getClientName(e.clientId)}
                        </span>
                      </div>
                      {e.description && (
                        <p className="mt-0.5 truncate text-sm text-slate-600">
                          {e.description}
                        </p>
                      )}
                    </div>
                    <div className="ml-4 flex items-center gap-2">
                      <span className="tabular-nums text-sm font-semibold text-slate-900">
                        {e.hours}t
                      </span>
                      <button
                        type="button"
                        onClick={() => removeEntry(e.id)}
                        className="text-slate-400 hover:text-red-600"
                        aria-label="Fjern"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: Totals */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
              <Users className="mr-1 inline h-4 w-4" /> Timer pr. kunde
            </h3>
            {clientTotals.length > 0 ? (
              <div className="space-y-3">
                {clientTotals.map((c) => (
                  <div key={c.id}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-700">{c.name}</span>
                      <span className="font-semibold text-slate-900">
                        {c.total}t
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500 transition-all"
                        style={{
                          width: `${grandTotal > 0 ? (c.total / grandTotal) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Ingen kunder tilføjet endnu.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-brand-200/60 bg-brand-50/50 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-brand-600">
              <Clock className="h-4 w-4" /> Total timer
            </div>
            <p className="mt-1 text-3xl font-bold text-slate-900">
              {grandTotal}t
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Fordelt på {clients.length} kunde
              {clients.length !== 1 ? "r" : ""}
            </p>
          </div>

          <p className="text-center text-xs text-slate-400">
            Data gemmes lokalt i din browser.
          </p>
        </div>
      </div>
    </div>
  );
}
