"use client";

import { HelpCircle } from "lucide-react";
import { useId, useState } from "react";

interface TooltipProps {
  content: string;
  children?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}

export function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const tooltipId = useId();
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
  };

  const arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-gray-900",
    right:
      "right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-gray-900",
    bottom:
      "bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-gray-900",
    left: "left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-gray-900",
  };

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-describedby={isVisible ? tooltipId : undefined}
        aria-label={!children ? content : undefined}
        className="inline-flex items-center text-gray-400 transition-colors hover:text-gray-600"
      >
        {children || <HelpCircle className="h-4 w-4" />}
      </button>

      {isVisible && (
        <div
          id={tooltipId}
          className={`absolute z-50 w-64 ${positionClasses[side]}`}
          role="tooltip"
        >
          <div className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white shadow-lg">
            {content}
          </div>
          <div className={`absolute h-0 w-0 border-4 ${arrowClasses[side]}`} />
        </div>
      )}
    </div>
  );
}

interface HelpTextProps {
  children: React.ReactNode;
}

export function HelpText({ children }: HelpTextProps) {
  return (
    <p className="mt-1 text-sm text-gray-500 flex items-start gap-1">
      {children}
    </p>
  );
}
