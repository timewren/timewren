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

type Delivery = { response?: Promise<Response>; stop: () => void };

const deliveryObservers = new Set<
  (body: unknown, response: Promise<Response>) => void
>();
let observedFetch: { original: typeof fetch; wrapper: typeof fetch } | null =
  null;

function isEventBody(body: unknown, event: ToolEvent) {
  if (typeof body !== "string") return false;
  try {
    const { type, payload } = JSON.parse(body);
    return (
      type === "event" &&
      payload?.name === event.name &&
      payload.data?.tool === event.data.tool
    );
  } catch {
    return false;
  }
}

const CLOUD_GATEWAY = "https://gateway.umami.is";

/**
 * Where a same-origin script proxy forwards collection: the script's own
 * directory, as in the docs' `/stats.js` + `/api/send` proxy. Undefined for a
 * cross-origin script, which keeps its own collector.
 */
function proxyBase(scriptUrl?: string) {
  if (!scriptUrl) return undefined;
  const url = new URL(scriptUrl, window.location.href);
  if (url.origin !== window.location.origin) return undefined;
  return `${url.origin}${url.pathname.slice(0, url.pathname.lastIndexOf("/"))}`;
}

/**
 * A proxied Umami Cloud script still sends to its built-in gateway, which CSP
 * only allows when the script loads from cloud.umami.is. Send those requests
 * through the same-origin proxy instead. Any other collector, such as one
 * built into a self-hosted tracker, is left alone.
 */
function throughProxy(input: RequestInfo | URL, proxy?: string) {
  if (!proxy || typeof input !== "string") return input;
  if (!input.startsWith(`${CLOUD_GATEWAY}/`)) return input;
  return `${proxy}${input.slice(CLOUD_GATEWAY.length)}`;
}

/**
 * Catches the response to the request the Umami tracker makes for `event`
 * while it is being tracked. The request passes through unchanged, except
 * that a proxied Cloud script's gateway request goes to `proxy`.
 */
function observeDelivery(event: ToolEvent, proxy?: string): Delivery {
  const delivery: Delivery = { stop: () => {} };
  const observer = (body: unknown, response: Promise<Response>) => {
    if (!delivery.response && isEventBody(body, event)) {
      delivery.response = response;
    }
  };
  deliveryObservers.add(observer);
  if (!observedFetch) {
    const original = globalThis.fetch;
    const wrapper: typeof fetch = (input, init) => {
      const response = original(throughProxy(input, proxy), init);
      for (const notify of deliveryObservers) notify(init?.body, response);
      return response;
    };
    observedFetch = { original, wrapper };
    globalThis.fetch = wrapper;
  }
  delivery.stop = () => {
    deliveryObservers.delete(observer);
    // Leave the wrapper in place if something else has wrapped fetch since.
    if (
      deliveryObservers.size === 0 &&
      observedFetch &&
      globalThis.fetch === observedFetch.wrapper
    ) {
      globalThis.fetch = observedFetch.original;
      observedFetch = null;
    }
  };
  return delivery;
}

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
      const delivery = observeDelivery(event, proxyBase(scriptUrl));
      try {
        await tracker.track((defaults) => ({ ...defaults, ...event }));
      } finally {
        delivery.stop();
      }
      // The tracker swallows network and HTTP errors, so judge by the request
      // it made. If it made none we cannot tell, and keep the visit as sent.
      if (!delivery.response) return true;
      return (await delivery.response).ok;
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
