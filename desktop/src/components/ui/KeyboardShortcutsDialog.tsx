import { useTranslation } from "react-i18next";
import { Dialog } from "./Dialog";
import { ShortcutBadge } from "./ShortcutKeys";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

type TFunction = (key: string) => string;

interface ShortcutRow {
  keys: string;
  label: string;
}

interface ShortcutGroup {
  heading: string;
  rows: ShortcutRow[];
}

/**
 * One list of every shortcut that actually works. The keys here are checked
 * against the handlers in useKeyboardShortcuts, useListKeyboard,
 * useSlotCursor and CommandPalette — a shortcut that does nothing is a claim
 * the product cannot keep, so it does not get a row.
 *
 * Rows are split per key when a shortcut only works in some of the views named
 * in the heading: ←→ moves between the columns of WeekView and a whole day in
 * DayView (both through `useSlotCursor`'s `onHorizontal`), but MonthView has no
 * cursor at all, so an "↑↓←→" row would promise arrows in a view that has
 * neither.
 */
function groups(t: TFunction): ShortcutGroup[] {
  return [
    {
      heading: t("shortcuts.everywhere"),
      rows: [
        { keys: "Ctrl+K", label: t("shortcuts.openPalette") },
        { keys: "?", label: t("shortcuts.openShortcuts") },
        { keys: "Ctrl+Shift+T", label: t("shortcuts.startTimer") },
        { keys: "Ctrl+Shift+S", label: t("shortcuts.stopTimer") },
        { keys: "Ctrl+N", label: t("shortcuts.newEntry") },
        { keys: "Ctrl+,", label: t("shortcuts.openSettings") },
        { keys: "Ctrl+1…6", label: t("shortcuts.switchPage") },
        { keys: "Esc", label: t("shortcuts.closeDialog") },
      ],
    },
    {
      heading: t("shortcuts.lists"),
      rows: [
        { keys: "j", label: t("shortcuts.nextRow") },
        { keys: "↓", label: t("shortcuts.nextRow") },
        { keys: "k", label: t("shortcuts.previousRow") },
        { keys: "↑", label: t("shortcuts.previousRow") },
        { keys: "Enter", label: t("shortcuts.openRow") },
        { keys: "e", label: t("shortcuts.editRow") },
        { keys: "d", label: t("shortcuts.deleteRow") },
        { keys: "Space", label: t("shortcuts.approveRow") },
        { keys: "Esc", label: t("shortcuts.deselectRow") },
      ],
    },
    {
      heading: t("shortcuts.calendar"),
      rows: [
        { keys: "↑↓", label: t("shortcuts.moveSlot") },
        { keys: "←→", label: t("shortcuts.changeDay") },
        { keys: "Enter", label: t("shortcuts.createEntryInSlot") },
      ],
    },
    // Egen gruppe, fordi `p` kun er monteret hvor timeren er: på dashboardet.
    // Lægtes den under «Overalt» ville den love en genvej på sider hvor der
    // ikke er noget at starte.
    {
      heading: t("shortcuts.pomodoro"),
      rows: [{ keys: "p", label: t("shortcuts.togglePomodoro") }],
    },
  ];
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
}: KeyboardShortcutsDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} title={t("shortcuts.title")}>
      <div className="max-h-[60vh] overflow-y-auto">
        <p className="mb-4 text-xs text-(--color-text-muted)">
          {t("shortcuts.intro")}
        </p>
        {groups(t).map((group) => (
          <section key={group.heading} className="mb-4 last:mb-0">
            <h3 className="mb-1.5 text-xs font-medium text-(--color-text-muted)">
              {group.heading}
            </h3>
            <dl>
              {group.rows.map((row) => (
                <div
                  key={`${group.heading}-${row.keys}-${row.label}`}
                  className="flex items-center gap-3 border-b border-(--color-border)/50 py-1.5 last:border-b-0"
                >
                  <dt className="text-xs text-(--color-text)">{row.label}</dt>
                  <dd className="flex min-w-0">
                    <ShortcutBadge keys={row.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
