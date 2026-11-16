"use client";

import { useEffect, useState } from "react";
import { useUiText } from "./use-ui-text";

const tipKeys = [
  "search",
  "rightClick",
  "templates",
  "kanban",
  "timerFromTask",
  "prepaid",
  "duplicate",
  "keys",
];

interface LoadingScreenProps {
  fullScreen?: boolean;
  message?: string;
  showTip?: boolean;
}

export function LoadingScreen({
  fullScreen = false,
  message,
  showTip = true,
}: LoadingScreenProps) {
  const t = useUiText();
  const [tipIndex] = useState(() => Math.floor(Math.random() * tipKeys.length));
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 150);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center ${fullScreen ? "min-h-screen" : "py-20"}`}
    >
      <div
        className={`flex flex-col items-center gap-5 transition-opacity duration-300 ${showContent ? "opacity-100" : "opacity-0"}`}
      >
        {/* Animated dots */}
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-600 dark:bg-brand-400 [animation-delay:0ms]" />
          <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-500 dark:bg-brand-400 [animation-delay:150ms]" />
          <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-brand-400 dark:bg-brand-500 [animation-delay:300ms]" />
        </div>

        {/* Message */}
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
          {message || t("loading.default")}
        </p>

        {/* Tip */}
        {showTip && (
          <p className="max-w-xs text-center text-xs text-gray-400 dark:text-gray-500">
            {t(`loading.tip.${tipKeys[tipIndex]}`)}
          </p>
        )}
      </div>
    </div>
  );
}

export function InlineSpinner({
  className = "h-5 w-5",
}: {
  className?: string;
}) {
  return (
    <div className="flex items-center justify-center">
      <div
        className={`${className} animate-spin rounded-full border-2 border-brand-600 border-t-transparent dark:border-brand-400`}
      />
    </div>
  );
}
