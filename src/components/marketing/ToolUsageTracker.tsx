"use client";

import { usePlausible } from "next-plausible";
import { type ReactNode, useRef } from "react";

/**
 * Fyrer ét `tool_used`-event (Plausible) ved den første interaktion med et
 * gratis værktøj — beregnerne er lead magnets, og uden dette event kan vi
 * ikke se hvilke værktøjer der reelt bruges og konverterer (issue #105).
 * Capture-fase så det virker uanset værktøjets interne struktur.
 */
export function ToolUsageTracker({
  tool,
  children,
}: {
  tool: string;
  children: ReactNode;
}) {
  const plausible = usePlausible();
  const fired = useRef(false);

  const handleInteraction = () => {
    if (fired.current) return;
    fired.current = true;
    plausible("tool_used", { props: { tool } });
  };

  return (
    <div
      onPointerDownCapture={handleInteraction}
      onKeyDownCapture={handleInteraction}
    >
      {children}
    </div>
  );
}
