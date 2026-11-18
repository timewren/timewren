"use client";

import Script from "next/script";
import {
  createContext,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { readConsent } from "@/lib/consent";

export const UmamiToolContext = createContext<
  ((tool: string, visit: object) => void) | null
>(null);

function hasAnalyticsConsent() {
  const doNotTrack = navigator.doNotTrack;
  return (
    Boolean(readConsent()?.analytics) &&
    doNotTrack !== "1" &&
    doNotTrack !== "yes"
  );
}

type ToolEvent = {
  url: string;
  title: string;
  name: "tool_used";
  data: { tool: string };
};

type UmamiWindow = Window & {
  umami?: {
    track: (update: (defaults: object) => object) => void | Promise<void>;
  };
};

export function UmamiToolAnalytics({
  collectUrl,
  scriptUrl,
  websiteId,
  children,
}: {
  collectUrl?: string;
  scriptUrl?: string;
  websiteId: string;
  children: ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  const trackedVisits = useRef(new WeakSet<object>());
  const pending = useRef(new Map<object, ToolEvent>());

  useEffect(() => {
    const syncConsent = () => {
      const allowed = hasAnalyticsConsent();
      if (!allowed) {
        trackedVisits.current = new WeakSet();
        pending.current.clear();
      }
      setEnabled(allowed);
    };
    syncConsent();
    window.addEventListener("cookie-consent-updated", syncConsent);
    return () =>
      window.removeEventListener("cookie-consent-updated", syncConsent);
  }, []);

  const canSend = () => {
    if (!hasAnalyticsConsent()) return false;
    try {
      return !localStorage.getItem("umami.disabled");
    } catch {
      return false;
    }
  };

  const send = async (event: ToolEvent) => {
    if (!collectUrl) {
      const tracker = (window as UmamiWindow).umami;
      if (!tracker) return false;
      await tracker.track((defaults) => ({ ...defaults, ...event }));
      return true;
    }

    const endpoint = new URL(collectUrl, window.location.origin);
    if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
      return false;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      keepalive: true,
      body: JSON.stringify({
        type: "event",
        payload: {
          website: websiteId,
          hostname: window.location.hostname,
          language: navigator.language,
          screen: `${window.screen.width}x${window.screen.height}`,
          ...event,
        },
      }),
    });
    return response.ok;
  };

  const submit = (visit: object, event: ToolEvent) => {
    const visits = trackedVisits.current;
    visits.add(visit);
    void send(event).then(
      (accepted) => {
        if (!accepted) visits.delete(visit);
      },
      () => visits.delete(visit),
    );
  };

  const flush = () => {
    if (canSend()) {
      for (const [visit, event] of pending.current) submit(visit, event);
    }
    pending.current.clear();
  };

  const trackTool = (tool: string, visit: object) => {
    if (
      !canSend() ||
      trackedVisits.current.has(visit) ||
      pending.current.has(visit)
    ) {
      return;
    }
    const event: ToolEvent = {
      url: window.location.pathname,
      title: document.title,
      name: "tool_used",
      data: { tool },
    };
    if (collectUrl || (window as UmamiWindow).umami) submit(visit, event);
    else if (scriptUrl) pending.current.set(visit, event);
  };

  return (
    <UmamiToolContext.Provider value={trackTool}>
      {enabled && !collectUrl && scriptUrl && (
        <Script
          src={scriptUrl}
          data-website-id={websiteId}
          data-auto-track="false"
          data-do-not-track="true"
          onReady={flush}
        />
      )}
      {children}
    </UmamiToolContext.Provider>
  );
}
