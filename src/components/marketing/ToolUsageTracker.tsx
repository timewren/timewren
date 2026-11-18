"use client";

import { usePlausible } from "next-plausible";
import { type ReactNode, useContext, useRef } from "react";
import { UmamiToolContext } from "./UmamiToolAnalytics";

/**
 * Måler første ændring eller aktivering af en værktøjsknap pr. besøg.
 */
export function ToolUsageTracker({
  tool,
  children,
}: {
  tool: string;
  children: ReactNode;
}) {
  const plausible = usePlausible();
  const trackUmami = useContext(UmamiToolContext);
  const visit = useRef({ plausibleFired: false });

  const track = () => {
    trackUmami?.(tool, visit.current);
    if (visit.current.plausibleFired) return;
    visit.current.plausibleFired = true;
    plausible("tool_used", { props: { tool } });
  };

  return (
    <div
      onChangeCapture={track}
      onClickCapture={({ target }) => {
        if (!(target instanceof Element) || target.closest("a")) return;
        if (
          target.closest(
            "button:not(:disabled), [role='button']:not([aria-disabled='true'])",
          )
        ) {
          track();
        }
      }}
    >
      {children}
    </div>
  );
}
