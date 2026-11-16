"use client";

import { Shape, ShapeStream } from "@electric-sql/client";
import { useEffect, useState } from "react";

/**
 * Generic ElectricSQL live-read hook (issue #260, beta spike). Subscribes to a
 * resource served by the auth-gatekeeper proxy (`/api/shapes/[resource]`) and
 * returns the live row set — updates automatically as rows change in Postgres.
 *
 * READ-ONLY: this is a live read. Writes stay on tRPC. Silently reports
 * `connected: false` when Electric is disabled (proxy 503/404), so callers can
 * degrade to a plain tRPC query.
 *
 * Note (spike): Electric shapes can't ORDER/LIMIT, so the full scoped row set
 * streams down and the caller sorts/slices client-side. Fine at beta scale;
 * revisit before syncing large tables in prod.
 */
export function useElectricShape<T = Record<string, unknown>>(
  resource: string,
  table: string,
): { connected: boolean; rows: T[] } {
  const [state, setState] = useState<{ connected: boolean; rows: T[] }>({
    connected: false,
    rows: [],
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const stream = new ShapeStream<Record<string, unknown>>({
      url: `${window.location.origin}/api/shapes/${resource}`,
      // `table` is stripped by the proxy (it fixes it server-side); passed only
      // to satisfy the client's required shape params.
      params: { table },
      onError: () => {
        if (!cancelled) setState((s) => ({ ...s, connected: false }));
      },
    });

    const shape = new Shape(stream);
    const unsubscribe = shape.subscribe(({ rows }) => {
      if (cancelled) return;
      setState({ connected: true, rows: rows as T[] });
    });

    return () => {
      cancelled = true;
      unsubscribe();
      stream.unsubscribeAll();
    };
  }, [resource, table]);

  return state;
}
