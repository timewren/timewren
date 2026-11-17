import type { Shape, ShapeStream } from "@electric-sql/client";
import { isDemoMode } from "@/lib/demo/demo-mode";

/**
 * Shared, ref-counted ElectricSQL subscription to the current user's own
 * `timer_states` row (issue #260 consolidation).
 *
 * Previously the badge (`useElectricTimer`) and the reconcile trigger
 * (`useTimerElectricSync`) each opened their own ShapeStream to
 * `/api/shapes/timer` — two long-poll connections per client to the same shape.
 * This module owns ONE stream: the first subscriber opens it, the last one
 * closes it, and every subscriber sees the same live state.
 *
 * Client-only: the stream is created lazily on first subscribe in the browser.
 * `@electric-sql/client` itself is loaded via dynamic import, so it stays out
 * of the shared dashboard bundle (Electric is only an invalidation signal, and
 * the prod proxy answers 503 anyway).
 */

export interface ElectricTimerRow {
  is_running: boolean;
  version: number;
  project_id: string | null;
  client_id: string | null;
  updated_at: string | null;
}

export interface ElectricTimerState {
  connected: boolean;
  row: ElectricTimerRow | null;
  lastUpdate: number | null;
}

type Listener = (state: ElectricTimerState) => void;

let stream: ShapeStream<Record<string, unknown>> | null = null;
let unsubscribeShape: (() => void) | null = null;
let refCount = 0;
// Bumped on every start/stop so a dynamic import that resolves after the last
// subscriber left (or after a restart) is discarded instead of opening a
// stale stream.
let generation = 0;
let state: ElectricTimerState = {
  connected: false,
  row: null,
  lastUpdate: null,
};
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(state);
}

function toRow(
  raw: Record<string, unknown> | undefined,
): ElectricTimerRow | null {
  if (!raw) return null;
  return {
    is_running: String(raw.is_running) === "true",
    version: Number(raw.version) || 0,
    project_id: (raw.project_id as string | null) ?? null,
    client_id: (raw.client_id as string | null) ?? null,
    updated_at: (raw.updated_at as string | null) ?? null,
  };
}

function start() {
  if (stream || typeof window === "undefined") return;
  // Den offentlige demo har ingen Electric; proxyen ville svare 503 i ring
  // (#1213). SSE + polling bærer synkroniseringen som uden Electric.
  if (isDemoMode()) return;
  const gen = ++generation;
  import("@electric-sql/client")
    .then((electric) => {
      if (gen !== generation || stream || refCount === 0) return;
      open(electric.Shape, electric.ShapeStream);
    })
    .catch(() => {
      // Chunk failed to load → same as Electric being unreachable: stay
      // silent; SSE + polling carry the sync.
    });
}

function open(ShapeCtor: typeof Shape, ShapeStreamCtor: typeof ShapeStream) {
  stream = new ShapeStreamCtor<Record<string, unknown>>({
    url: `${window.location.origin}/api/shapes/timer`,
    // `table` is stripped by the proxy (it fixes it server-side); passed only
    // to satisfy the client's required shape params.
    params: { table: "timer_states" },
    onError: () => {
      // Electric off/unreachable → stay silent; SSE + polling carry the sync.
      state = { ...state, connected: false };
      emit();
    },
  });
  const shape = new ShapeCtor(stream);
  unsubscribeShape = shape.subscribe(({ rows }) => {
    state = {
      connected: true,
      row: toRow(rows[0] as Record<string, unknown> | undefined),
      lastUpdate: Date.now(),
    };
    emit();
  });
}

function stop() {
  generation += 1;
  unsubscribeShape?.();
  stream?.unsubscribeAll();
  unsubscribeShape = null;
  stream = null;
  state = { connected: false, row: null, lastUpdate: null };
}

/**
 * Subscribe to the shared Electric timer state. Returns an unsubscribe fn.
 * The underlying stream is opened on the first subscriber and closed when the
 * last one unsubscribes. The listener is called immediately with current state.
 */
export function subscribeElectricTimer(listener: Listener): () => void {
  listeners.add(listener);
  refCount += 1;
  if (refCount === 1) start();
  listener(state);
  return () => {
    listeners.delete(listener);
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      stop();
    }
  };
}
