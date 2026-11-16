"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBrand } from "@/components/BrandContext";
import { useModules } from "@/hooks/useModules";
import { useTourStore } from "@/stores/tourStore";
import { filterTourSteps, type TourStep, tourSteps } from "./tour-steps";

const PADDING = 8;
const TOOLTIP_GAP = 12;
const TOOLTIP_MAX_WIDTH = 380;

function getTooltipWidth() {
  if (typeof window === "undefined") return TOOLTIP_MAX_WIDTH;
  return Math.min(window.innerWidth - 32, TOOLTIP_MAX_WIDTH);
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getTargetRect(target: string): Rect | null {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
  };
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function getTooltipPosition(
  rect: Rect,
  placement: TourStep["placement"],
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipW = getTooltipWidth();

  let top = 0;
  let left = 0;

  switch (placement) {
    case "right":
      top = rect.top + rect.height / 2;
      left = rect.left + rect.width + TOOLTIP_GAP;
      break;
    case "left":
      top = rect.top + rect.height / 2;
      left = rect.left - TOOLTIP_GAP - tooltipW;
      break;
    case "bottom":
      top = rect.top + rect.height + TOOLTIP_GAP;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case "top":
      top = rect.top - TOOLTIP_GAP - 200;
      left = rect.left + rect.width / 2 - tooltipW / 2;
      break;
    case "center":
      top = vh / 2 - 120;
      left = vw / 2 - tooltipW / 2;
      break;
  }

  // Viewport clamping
  left = clamp(left, 12, vw - tooltipW - 12);
  top = clamp(top, 12, vh - 200);

  return { top, left };
}

/** Nøgle i tour.section for hver (dansk) sektion i tour-steps. */
const sectionKeys: Record<string, string> = {
  Velkommen: "welcome",
  Tidsregistrering: "time",
  Opgaver: "tasks",
  "Kunder & Projekter": "clients",
  "Klippekort & Fakturering": "billing",
  Indstillinger: "settings",
  Afslutning: "finish",
};

const sectionColors: Record<string, string> = {
  Velkommen: "text-blue-600 dark:text-blue-400",
  Tidsregistrering: "text-emerald-600 dark:text-emerald-400",
  Opgaver: "text-purple-600 dark:text-purple-400",
  "Kunder & Projekter": "text-orange-600 dark:text-orange-400",
  "Klippekort & Fakturering": "text-pink-600 dark:text-pink-400",
  Indstillinger: "text-gray-600 dark:text-gray-400",
  Afslutning: "text-blue-600 dark:text-blue-400",
};

const sectionBarColors: Record<string, string> = {
  Velkommen: "bg-blue-500",
  Tidsregistrering: "bg-emerald-500",
  Opgaver: "bg-purple-500",
  "Kunder & Projekter": "bg-orange-500",
  "Klippekort & Fakturering": "bg-pink-500",
  Indstillinger: "bg-gray-500",
  Afslutning: "bg-blue-500",
};

export function GuidedTour() {
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const t = useTranslations("tour");
  const { currentStep, nextStep, prevStep, skipTour, completeTour, setStep } =
    useTourStore();
  const [rect, setRect] = useState<Rect | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Loop-værn: hvilket step har vi allerede forsøgt at navigere for?
  const navAttemptedRef = useRef<number | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const { isEnabled: isModuleEnabled, isLoading: modulesLoading } =
    useModules();
  const steps = useMemo(
    // Vent på rigtige moduldata — placeholderen ville inkludere steps for
    // moduler organisationen ikke har (og deres sider redirecter væk)
    () => (modulesLoading ? [] : filterTourSteps(tourSteps, isModuleEnabled)),
    [isModuleEnabled, modulesLoading],
  );

  // If the filtered step list shrinks (e.g. the user disables a module on the
  // _modules_setup step), clamp currentStep so it never points past the end —
  // otherwise steps[currentStep] is undefined and the tour disappears.
  useEffect(() => {
    if (steps.length > 0 && currentStep > steps.length - 1) {
      setStep(steps.length - 1);
    }
  }, [steps, currentStep, setStep]);

  const step = steps[currentStep] as TourStep | undefined;
  const isLastStep = currentStep >= steps.length - 1;
  const isFirstStep = currentStep === 0;
  const isCentered = step?.highlight === false;

  const updatePosition = useCallback(() => {
    if (!step) return;

    if (isCentered) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setRect(null);
      setTooltipPos({
        top: vh / 2 - 120,
        left: vw / 2 - getTooltipWidth() / 2,
      });
      return;
    }

    const r = getTargetRect(step.target);
    if (r) {
      setRect(r);
      setTooltipPos(getTooltipPosition(r, step.placement));
    }
    // If element not found, do nothing — the retry logic in the effect handles it
  }, [step, isCentered]);

  // Handle page navigation and element polling when step changes
  useEffect(() => {
    if (!step || !mounted) return;

    // Clear any pending retries
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }

    const targetPage = step.page;
    const needsNavigation = targetPage && pathname !== targetPage;

    if (needsNavigation) {
      if (navAttemptedRef.current === currentStep) {
        // Vi har allerede pushet step.page for dette step og er blevet
        // redirected væk igen (fx af ModuleGuard) — spring steppet over i
        // stedet for at navigere i ring.
        setNavigating(false);
        if (isLastStep) {
          completeTour();
        } else {
          nextStep();
        }
        return;
      }
      navAttemptedRef.current = currentStep;
      setNavigating(true);
      router.push(targetPage);
    }

    // Poll for the target element with retries
    const MAX_RETRIES = 20;
    const RETRY_INTERVAL = 250;
    let attempt = 0;
    const initialDelay = needsNavigation ? step.waitFor || 500 : 100;

    const tryFindElement = () => {
      if (step.highlight === false) {
        // Centered step — no element needed
        setNavigating(false);
        updatePosition();
        return;
      }

      const r = getTargetRect(step.target);
      if (r) {
        setNavigating(false);
        setRect(r);
        setTooltipPos(getTooltipPosition(r, step.placement));
        return;
      }

      attempt++;
      if (attempt < MAX_RETRIES) {
        retryRef.current = setTimeout(tryFindElement, RETRY_INTERVAL);
      } else {
        // Element truly not found after all retries — skip this step
        setNavigating(false);
        if (isLastStep) {
          completeTour();
        } else {
          nextStep();
        }
      }
    };

    const timeout = setTimeout(tryFindElement, initialDelay);
    return () => {
      clearTimeout(timeout);
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [
    currentStep,
    step,
    mounted,
    pathname,
    router,
    updatePosition,
    isLastStep,
    completeTour,
    nextStep,
  ]);

  // Mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Reposition on resize and scroll
  useEffect(() => {
    if (!mounted) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [mounted, updatePosition]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skipTour();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (isLastStep) {
          completeTour();
        } else {
          nextStep();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentStep > 0) prevStep();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [currentStep, isLastStep, nextStep, prevStep, skipTour, completeTour]);

  if (!mounted || !step || navigating) return null;

  const stepTitle = t.has(`step.${step.target}.title`)
    ? t(`step.${step.target}.title`, { brand: brand.name })
    : step.title;
  const stepDescription = t.has(`step.${step.target}.description`)
    ? t(`step.${step.target}.description`, { brand: brand.name })
    : step.description;
  const sectionKey = step.section ? sectionKeys[step.section] : undefined;
  const sectionLabel = sectionKey ? t(`section.${sectionKey}`) : step.section;
  // For highlighted steps, we need rect
  if (!isCentered && !rect) return null;

  const progressPct = ((currentStep + 1) / steps.length) * 100;
  const sectionColor = step.section
    ? sectionColors[step.section] || "text-brand-600 dark:text-brand-400"
    : "text-brand-600";
  const currentBarColor = step.section
    ? sectionBarColors[step.section] || "bg-brand-500"
    : "bg-brand-500";

  return createPortal(
    <div role="presentation" className="fixed inset-0 z-[200]">
      {/* Spotlight overlay — box-shadow technique */}
      {!isCentered && rect && (
        <>
          <div
            className="absolute rounded-lg transition-all duration-300 ease-in-out"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
              pointerEvents: "none",
            }}
          />
          {/* Pulse ring animation */}
          <div
            className="absolute rounded-lg animate-pulse-ring"
            style={{
              top: rect.top - 4,
              left: rect.left - 4,
              width: rect.width + 8,
              height: rect.height + 8,
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {/* Dark overlay for centered (no-spotlight) steps */}
      {isCentered && (
        <div
          className="absolute inset-0 bg-black/50 transition-opacity duration-300"
          style={{ pointerEvents: "none" }}
        />
      )}

      {/* Click blocker for the rest of the page */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: overlay blocks clicks during tour */}
      <div
        role="presentation"
        className="absolute inset-0"
        style={{ pointerEvents: "auto" }}
        onClick={(e) => {
          e.stopPropagation();
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-label={stepTitle}
        className="absolute z-[201] transition-all duration-300 ease-in-out"
        style={{
          top: tooltipPos.top,
          left: tooltipPos.left,
          width: getTooltipWidth(),
          pointerEvents: "auto",
        }}
      >
        <div className="rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
          {/* Section label + Progress */}
          <div className="px-4 pt-3 pb-1">
            <div className="flex items-center justify-between mb-2">
              {step.section && (
                <span
                  className={`text-xs font-semibold uppercase tracking-wide ${sectionColor}`}
                >
                  {sectionLabel}
                </span>
              )}
              <span className="text-xs font-medium text-gray-400 dark:text-gray-500 ml-auto">
                {currentStep + 1} / {steps.length}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${currentBarColor}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Content */}
          <div className="px-4 pt-2 pb-3">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {stepTitle}
            </h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {stepDescription}
            </p>
          </div>

          {/* Navigation + skip */}
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 px-4 py-3">
            {/* Skip button */}
            <button
              type="button"
              onClick={skipTour}
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            >
              {t("ui.skip")}
            </button>

            {/* Navigation buttons */}
            <div className="flex items-center gap-2">
              {!isFirstStep && (
                <button
                  type="button"
                  onClick={prevStep}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
                >
                  {t("ui.back")}
                </button>
              )}
              <button
                type="button"
                onClick={isLastStep ? completeTour : nextStep}
                className="rounded-lg bg-tt-gran px-4 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk transition-colors"
              >
                {isLastStep
                  ? t("ui.finish")
                  : isFirstStep
                    ? t("ui.start")
                    : t("ui.next")}
              </button>
            </div>
          </div>

          {/* Keyboard hints */}
          <div className="flex items-center justify-center gap-3 border-t border-gray-50 dark:border-gray-700/50 px-4 py-2">
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              <kbd className="rounded border border-gray-200 dark:border-gray-600 px-1 py-0.5 font-mono text-[10px]">
                ←
              </kbd>{" "}
              <kbd className="rounded border border-gray-200 dark:border-gray-600 px-1 py-0.5 font-mono text-[10px]">
                →
              </kbd>{" "}
              {t("ui.navigate")}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              <kbd className="rounded border border-gray-200 dark:border-gray-600 px-1 py-0.5 font-mono text-[10px]">
                Esc
              </kbd>{" "}
              {t("ui.close")}
            </span>
          </div>
        </div>
      </div>

      {/* Pulse animation style — dangerouslySetInnerHTML to avoid styled-jsx dependency */}
      <style
        // biome-ignore lint/security/noDangerouslySetInnerHtml: statiske CSS-keyframes uden brugerinput
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes tour-pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
          70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
        .animate-pulse-ring {
          animation: tour-pulse-ring 2s ease-in-out infinite;
        }
      `,
        }}
      />
    </div>,
    document.body,
  );
}
