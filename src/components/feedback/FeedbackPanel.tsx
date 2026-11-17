"use client";

/**
 * Feedback i dashboardet via bugbottles eget panel (`bugbottle/ui`).
 *
 * Komponenten tegner intet selv: den monterer panelet i et shadow root på
 * `document.body`. Farver, font og placering kommer fra `[data-bugbottle="ui"]`
 * i `globals.css`. Desktop har den flydende knap; under lg skjules den, og
 * brugermenuens "Send feedback" åbner panelet via `OPEN_FEEDBACK_EVENT`.
 *
 * Alt fra bugbottle hentes dynamisk. Skærmbillede (`html-to-image`), område/
 * element (`bugbottle/region`) og tegning (`bugbottle/annotate`) hentes først,
 * når brugeren beder om et billede.
 */

import type { Annotator, createAnnotator } from "bugbottle/annotate";
import type { captureRegion } from "bugbottle/region";
import type { BugbottleWidget } from "bugbottle/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { shortReportId } from "@/lib/feedback/report-id";
import { onFeedbackSignOut } from "@/lib/feedback/sign-out";
import {
  FEEDBACK_USER_HEADER,
  OPEN_FEEDBACK_EVENT,
  toReportType,
} from "@/lib/feedback/types";
import { buildVersion } from "@/lib/pwa/version";
import { useTimerStore } from "@/stores/timerStore";

type ScreenshotRenderer = (
  root: HTMLElement,
  options: { filter: (node: Node) => boolean; pixelRatio: number },
) => Promise<string>;

let annotateModule: typeof import("bugbottle/annotate") | null = null;
function loadAnnotate() {
  return import("bugbottle/annotate").then((m) => {
    annotateModule = m;
    return m;
  });
}

const screenshot: ScreenshotRenderer = async (root, options) => {
  // Tegneværktøjet skal bruges lige om lidt, hvis brugeren vil markere billedet
  void loadAnnotate().catch(() => {});
  const { htmlToImage } = await import("bugbottle/html-to-image");
  return htmlToImage(root, options);
};

const region: typeof captureRegion = async (render, mode, options) => {
  const m = await import("bugbottle/region");
  return m.captureRegion(render, mode, options);
};

/**
 * Panelet kalder `annotate` synkront. Er modulet hentet (det sker, når
 * billedet tages), bruges det direkte; ellers står en stedfortræder, der
 * venter på modulet og så giver videre.
 */
const annotate: typeof createAnnotator = (canvas, dataUrl, options = {}) => {
  if (annotateModule) {
    return annotateModule.createAnnotator(canvas, dataUrl, options);
  }
  let real: Annotator | null = null;
  let destroyed = false;
  let tool = options.tool ?? "rect";
  const ready = loadAnnotate().then((m) => {
    // Lukket før modulet nåede frem: intet at vise og ingen fejl at melde
    if (destroyed) return;
    real = m.createAnnotator(canvas, dataUrl, { ...options, tool });
    return real.ready;
  });
  return {
    ready,
    setTool: (next) => {
      tool = next;
      real?.setTool(next);
    },
    getTool: () => real?.getTool() ?? tool,
    undo: () => real?.undo() ?? false,
    clear: () => real?.clear(),
    count: () => real?.count() ?? 0,
    toDataUrl: () => real?.toDataUrl() ?? dataUrl,
    destroy: () => {
      destroyed = true;
      real?.destroy();
    },
  };
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function FeedbackPanel({ userId }: { userId: string }) {
  const t = useTranslations("feedback.panel");
  const locale = useLocale();
  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    let widget: BugbottleWidget | null = null;
    let cancelled = false;
    // Mobilmenuen kan nå at sende eventet, før panelet er hentet
    let openWhenReady = false;
    const cleanups: (() => void)[] = [];

    function onOpen() {
      if (widget) widget.open();
      else openWhenReady = true;
    }
    window.addEventListener(OPEN_FEEDBACK_EVENT, onOpen);

    void (async () => {
      const [core, ui, locales, breadcrumbs, queueModule, idb] =
        await Promise.all([
          import("bugbottle"),
          import("bugbottle/ui"),
          import("bugbottle/locales"),
          import("bugbottle/breadcrumbs"),
          import("bugbottle/queue"),
          import("bugbottle/queue-idb"),
        ]);
      if (cancelled) return;

      cleanups.push(breadcrumbs.initBreadcrumbs());

      // Køen er nøglet pr. bruger, og hver rapport bærer brugerens id i en
      // header, som ruten afviser (409), hvis sessionen er en anden bruger.
      // Så en rapport i kø aldrig gemmes under en anden brugers session på en
      // delt browser, heller ikke fra en gammel fane. IndexedDB frem for
      // localStorage: et skærmbillede på 1-2 MB skal ikke æde den kvote,
      // timer- og opgave-stores deler.
      const headers = { [FEEDBACK_USER_HEADER]: userId };
      const queue = queueModule.createQueue({
        endpoint: "/api/feedback",
        headers,
        storage: idb.createIdbStorage({
          databaseName: "timetrack-feedback",
          storageKey: `queue:${userId}`,
        }),
        maxEntries: 5,
      });
      cleanups.push(() => queue.destroy());
      cleanups.push(
        onFeedbackSignOut(async () => {
          try {
            await Promise.race([queue.flush(), delay(1200)]);
          } finally {
            queue.clear();
          }
        }),
      );

      const panelLocale =
        locales.locales[locale] ?? locales.locales.da ?? locales.da;
      widget = ui.mountBugbottle({
        endpoint: "/api/feedback",
        locale: panelLocale,
        // TimeTrack er én person, så "vi" og "os" skrives ud af de tekster,
        // brugeren ser. Titlen er TimeTracks egen fra før panelet
        texts: {
          trigger: tRef.current("trigger"),
          title: tRef.current("title"),
          intro: tRef.current("intro"),
          thanks: tRef.current("thanks"),
          openedByError: tRef.current("openedByError"),
          types: {
            other: tRef.current("typeOther"),
            idea: tRef.current("typeIdea"),
            bug: tRef.current("typeBug"),
          },
        },
        // De første 8 tegn af rækkens uuid, som listen på /admin/feedback
        formatReportId: shortReportId,
        // TimeTracks rækkefølge: feedback, idé, fejl — og åbner på feedback
        types: [
          toReportType("feedback"),
          toReportType("feature"),
          toReportType("bug"),
        ],
        initialType: toReportType("feedback"),
        headers,
        screenshot,
        region,
        annotate,
        queue,
        // GDPR: redigér e-mails, tokens, kortnumre m.m. ud før rapporten sendes
        scrub: core.scrubReport,
        // Læses ved hvert tryk på Send, så timeren er den, der kører nu
        extra: () => {
          const { isRunning, projectId, clientId, startTime } =
            useTimerStore.getState();
          return {
            appVersion: buildVersion() ?? "ukendt",
            timer: { isRunning, projectId, clientId, startTime },
          };
        },
        // Ctrl+Shift+B er Chromes bogmærkelinje
        shortcut: false,
        // Ingen toast: panelets bekræftelse med nummer er kvitteringen, og en
        // afvist indsendelse står med rødt i panelet selv
        onSent: (_id, report) => {
          if (report.type === "bug") {
            import("@sentry/nextjs")
              .then((Sentry) =>
                Sentry.captureFeedback({ message: report.message }),
              )
              .catch(() => {});
          }
        },
      });
      cleanups.push(() => widget?.destroy());
      if (openWhenReady) widget.open();
    })().catch((err) => {
      console.warn("[Feedback] Panelet kunne ikke indlæses", err);
    });

    return () => {
      cancelled = true;
      window.removeEventListener(OPEN_FEEDBACK_EVENT, onOpen);
      for (const off of cleanups.reverse()) off();
      widget = null;
    };
  }, [userId, locale]);

  return null;
}
