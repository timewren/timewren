"use client";

import {
  AlertTriangle,
  RefreshCw,
  ServerCrash,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { isNetworkError } from "@/lib/offline/queue";
import { useUiScope } from "./use-ui-text";

type ErrorType = "network" | "server" | "notFound" | "permission" | "unknown";

interface ErrorStateProps {
  title?: string;
  message?: string;
  error?: Error | null;
  errorType?: ErrorType;
  onRetry?: () => void;
  isRetrying?: boolean;
  showDetails?: boolean;
  compact?: boolean;
  className?: string;
}

const errorConfig: Record<ErrorType, { icon: typeof AlertTriangle }> = {
  network: { icon: WifiOff },
  server: { icon: ServerCrash },
  notFound: { icon: XCircle },
  permission: { icon: AlertTriangle },
  unknown: { icon: AlertTriangle },
};

// Detect error type from error object
function detectErrorType(error?: Error | null): ErrorType {
  if (!error) return "unknown";

  // tRPC-fejl: status fra serveren og netværksfejl via cause, da beskeden
  // er oversat til dansk (lib/trpc/friendly-error.ts).
  if (isNetworkError(error)) return "network";
  const status = (error as { data?: { httpStatus?: number } | null }).data
    ?.httpStatus;
  if (status === 401 || status === 403) return "permission";
  if (status === 404) return "notFound";
  if (status && status >= 500) return "server";

  const message = error.message.toLowerCase();

  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("offline")
  ) {
    return "network";
  }

  if (
    message.includes("500") ||
    message.includes("server") ||
    message.includes("internal")
  ) {
    return "server";
  }

  if (message.includes("404") || message.includes("not found")) {
    return "notFound";
  }

  if (
    message.includes("401") ||
    message.includes("403") ||
    message.includes("unauthorized") ||
    message.includes("forbidden")
  ) {
    return "permission";
  }

  return "unknown";
}

export function ErrorState({
  title,
  message,
  error,
  errorType,
  onRetry,
  isRetrying = false,
  showDetails = process.env.NODE_ENV === "development",
  compact = false,
  className = "",
}: ErrorStateProps) {
  const t = useUiScope("error");
  const [isOnline, setIsOnline] = useState(true);

  // Monitor online status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const type = errorType || detectErrorType(error);
  const config = errorConfig[type];
  const Icon = config.icon;

  const displayTitle = title || t(`${type}.title`);
  const displayMessage = message || error?.message || t(`${type}.message`);

  if (compact) {
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 ${className}`}
      >
        <Icon className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            {displayTitle}
          </p>
          <p className="text-xs text-red-600 dark:text-red-400 truncate">
            {displayMessage}
          </p>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="shrink-0 rounded-md bg-red-100 dark:bg-red-800 p-1.5 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-8 text-center ${className}`}
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
        <Icon className="h-8 w-8 text-red-600 dark:text-red-400" />
      </div>

      <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">
        {displayTitle}
      </h3>

      <p className="mb-4 max-w-sm text-sm text-gray-600 dark:text-gray-400">
        {displayMessage}
      </p>

      {/* Online status indicator */}
      {!isOnline && (
        <div className="mb-4 flex items-center gap-2 rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-3 py-1 text-sm text-yellow-800 dark:text-yellow-200">
          <WifiOff className="h-4 w-4" />
          {t("offline")}
        </div>
      )}

      {isOnline && (
        <div className="mb-4 flex items-center gap-2 rounded-full bg-green-100 dark:bg-green-900/30 px-3 py-1 text-sm text-green-800 dark:text-green-200">
          <Wifi className="h-4 w-4" />
          {t("connected")}
        </div>
      )}

      {/* Error details in development */}
      {showDetails && error && (
        <div className="mb-4 w-full max-w-md rounded-lg bg-gray-100 dark:bg-gray-900 p-4 text-left">
          <p className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
            {t("details")}
          </p>
          <pre className="overflow-x-auto text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">
            {error.message}
          </pre>
          {error.stack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                Stack trace
              </summary>
              <pre className="mt-1 overflow-x-auto text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                {error.stack.split("\n").slice(1, 6).join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* Retry button */}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying || !isOnline}
          className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2.5 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
          />
          {isRetrying ? t("retrying") : t("retry")}
        </button>
      )}
    </div>
  );
}

// Loading state with better UX
interface LoadingStateProps {
  text?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function LoadingState({
  text,
  size = "md",
  className = "",
}: LoadingStateProps) {
  const t = useUiScope("error");
  const shownText = text ?? t("loading");
  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-8 w-8",
    lg: "h-12 w-12",
  };

  const textSizes = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div
      className={`flex flex-col items-center justify-center p-8 ${className}`}
    >
      <InlineSpinner className={sizeClasses[size]} />
      {shownText && (
        <p
          className={`mt-3 ${textSizes[size]} text-gray-600 dark:text-gray-400`}
        >
          {shownText}
        </p>
      )}
    </div>
  );
}
