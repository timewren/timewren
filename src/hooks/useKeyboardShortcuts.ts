"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  action: () => void;
  description: string;
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean;
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutConfig[],
  options: UseKeyboardShortcutsOptions = {},
) {
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in input fields
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isTyping) return;

      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrl
          ? e.ctrlKey || e.metaKey
          : !e.ctrlKey && !e.metaKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

        if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
          e.preventDefault();
          shortcut.action();
          break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, enabled]);
}

// Hook for common dashboard shortcuts
export function useDashboardShortcuts() {
  const router = useRouter();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const shortcuts: ShortcutConfig[] = [
    {
      key: "n",
      action: () => router.push("/dashboard/clients/new"),
      description: "Ny kunde",
    },
    {
      key: "p",
      action: () => router.push("/dashboard/projects/new"),
      description: "Nyt projekt",
    },
    {
      key: "t",
      action: () => router.push("/dashboard/time/new"),
      description: "Registrer tid",
    },
    {
      key: "i",
      action: () => router.push("/dashboard/invoices/new"),
      description: "Ny faktura",
    },
    {
      key: "/",
      action: () => {
        // Focus search input if available
        const searchInput = document.querySelector(
          'input[type="text"][placeholder*="Søg"]',
        ) as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      },
      description: "Søg",
    },
    {
      key: "?",
      shift: true,
      action: () => setShowShortcutsHelp((prev) => !prev),
      description: "Vis genvejstaster",
    },
    {
      key: "Escape",
      action: () => {
        setShowShortcutsHelp(false);
        // Blur active element
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      },
      description: "Luk/Afbryd",
    },
    {
      key: "g",
      action: () => {},
      description: "Gå til... (prefix)",
    },
  ];

  // Go to shortcuts (g + key)
  const [goToMode, setGoToMode] = useState(false);

  const goToShortcuts: ShortcutConfig[] = [
    {
      key: "g",
      action: () => setGoToMode(true),
      description: "Aktivér 'gå til' mode",
    },
  ];

  const goToActions: ShortcutConfig[] = goToMode
    ? [
        {
          key: "c",
          action: () => {
            router.push("/dashboard/clients");
            setGoToMode(false);
          },
          description: "Gå til kunder",
        },
        {
          key: "p",
          action: () => {
            router.push("/dashboard/projects");
            setGoToMode(false);
          },
          description: "Gå til projekter",
        },
        {
          key: "t",
          action: () => {
            router.push("/dashboard/time");
            setGoToMode(false);
          },
          description: "Gå til tid",
        },
        {
          key: "i",
          action: () => {
            router.push("/dashboard/invoices");
            setGoToMode(false);
          },
          description: "Gå til fakturaer",
        },
        {
          key: "d",
          action: () => {
            router.push("/dashboard");
            setGoToMode(false);
          },
          description: "Gå til Hjem",
        },
        {
          key: "o",
          action: () => {
            router.push("/dashboard/overblik");
            setGoToMode(false);
          },
          description: "Gå til Overblik",
        },
        {
          key: "s",
          action: () => {
            router.push("/dashboard/settings");
            setGoToMode(false);
          },
          description: "Gå til indstillinger",
        },
        {
          key: "Escape",
          action: () => setGoToMode(false),
          description: "Annullér",
        },
      ]
    : [];

  // Cancel go-to mode after timeout
  useEffect(() => {
    if (goToMode) {
      const timer = setTimeout(() => setGoToMode(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [goToMode]);

  useKeyboardShortcuts(
    goToMode ? goToActions : [...shortcuts, ...goToShortcuts],
  );

  return {
    shortcuts,
    showShortcutsHelp,
    setShowShortcutsHelp,
    goToMode,
  };
}
