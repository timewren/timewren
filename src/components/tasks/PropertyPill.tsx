"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface PropertyPillProps {
  icon?: ReactNode;
  label: string;
  /** Skærmlæsernavn, når label alene ikke siger hvilket felt det er. */
  ariaLabel?: string;
  color?: string;
  bgColor?: string;
  popoverRole?: string;
  children: (close: () => void) => ReactNode;
}

export function PropertyPill({
  icon,
  label,
  ariaLabel,
  color = "text-gray-600 dark:text-gray-300",
  bgColor = "bg-gray-100 dark:bg-gray-700",
  popoverRole = "listbox",
  children,
}: PropertyPillProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`
          flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
          transition-colors cursor-pointer
          ${bgColor} ${color}
          hover:opacity-80
        `}
      >
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className="truncate max-w-[120px]">{label}</span>
        <ChevronDown
          className={`h-3 w-3 flex-shrink-0 opacity-60 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role={popoverRole}
          className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

interface PillOptionProps {
  label: string;
  selected?: boolean;
  icon?: ReactNode;
  color?: string;
  onClick: () => void;
}

export function PillOption({
  label,
  selected,
  icon,
  color = "text-gray-700 dark:text-gray-300",
  onClick,
}: PillOptionProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={`
        flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs
        transition-colors cursor-pointer
        hover:bg-gray-100 dark:hover:bg-gray-700/50
        ${color}
      `}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span className="flex-1 text-left">{label}</span>
      {selected && (
        <Check className="h-3.5 w-3.5 flex-shrink-0 text-brand-500 dark:text-brand-400" />
      )}
    </button>
  );
}
