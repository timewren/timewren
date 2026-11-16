/**
 * Shared rendering of keyboard shortcut keys, so the command palette and the
 * shortcut overview can never disagree about how a key looks.
 */

// Show the Command symbol on macOS instead of "Ctrl".
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac/i.test(navigator.platform || navigator.userAgent || "");

export function ShortcutBadge({ keys }: { keys: string }) {
  return (
    <span className="ml-auto flex items-center gap-0.5">
      {keys.split("+").map((key) => (
        <kbd
          key={key}
          className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-(--color-border) bg-(--color-surface) px-1.5 font-mono text-[10px] text-(--color-text-muted)"
        >
          {IS_MAC && key === "Ctrl" ? "⌘" : key}
        </kbd>
      ))}
    </span>
  );
}
