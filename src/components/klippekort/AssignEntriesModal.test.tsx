// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import common from "@/i18n/messages/da/common.json";
import home from "@/i18n/messages/da/home.json";
import klippekort from "@/i18n/messages/da/klippekort.json";
import reports from "@/i18n/messages/da/reports.json";
import time from "@/i18n/messages/da/time.json";
import ui from "@/i18n/messages/da/ui.json";
import { AssignEntriesModal } from "./AssignEntriesModal";
import { BulkAssignPrepaidModal } from "./BulkAssignPrepaidModal";

const { assign } = vi.hoisted(() => ({ assign: vi.fn() }));
const entry = {
  id: "entry-1",
  date: new Date("2026-11-18"),
  projectId: "project-1",
  projectName: "Webprojekt",
  description: "Design af forside",
  hours: 0.17,
  prepaidPackageId: "old-card",
  prepaidPackageName: "Efterårskort",
  prepaidHoursRestored: 0.25,
};

const unlinkedEntry = {
  ...entry,
  id: "entry-2",
  prepaidPackageId: null,
  prepaidPackageName: null,
  prepaidHoursRestored: 0,
};

vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    useUtils: () => ({}),
    prepaid: {
      getPackagesForEntries: {
        useQuery: () => ({
          data: {
            clientId: "client-1",
            packages: [
              {
                id: "allow-card",
                name: "Allow card",
                remainingHours: 0,
                clipSizeMinutes: null,
                overdraftPolicy: "allow",
              },
              {
                id: "block-card",
                name: "Block card",
                remainingHours: 0,
                clipSizeMinutes: null,
                overdraftPolicy: "block",
              },
            ],
          },
        }),
      },
      getAssignableProjects: {
        useQuery: () => ({
          data: [{ id: entry.projectId, name: entry.projectName }],
        }),
      },
      getAssignableEntries: {
        useQuery: (input: {
          includeOtherCards: boolean;
          timeEntryIds?: string[];
        }) => ({
          data: input.timeEntryIds
            ? [entry, unlinkedEntry].filter(({ id }) =>
                input.timeEntryIds?.includes(id),
              )
            : input.includeOtherCards
              ? [entry, unlinkedEntry]
              : [unlinkedEntry],
        }),
      },
      bulkAssignEntries: { useMutation: () => ({ mutate: assign }) },
    },
  },
}));

it.each([
  {
    policy: "block",
    remaining: 5,
    balance: "4 t 30 min",
    confirmation:
      "Før 0,25 timer tilbage til Efterårskort og træk 0,5 timer fra Vinterkort.",
  },
  {
    policy: "block",
    remaining: 0.25,
    balance: "15 min",
    confirmation: null,
    warning: "Der er 15 min tilbage, og det mindste træk er 30 min.",
  },
  {
    policy: "block",
    remaining: 0.33,
    balance: "20 min",
    clipSizeMinutes: 20,
    confirmation: null,
    warning: "Der er 0,33 t tilbage, og det mindste træk er 0,34 t.",
  },
  {
    policy: "block",
    remaining: 0.75,
    balance: "45 min",
    selectBoth: true,
    confirmation: null,
    warning:
      "Der er 45 min tilbage, men saldoen dækker højst 30 min i én postering.",
  },
  {
    // Regression: to posteringer á 0,33 t trækker 0,34 t hver, og en
    // postering på 0,67 t rundes op til tre klip. Kun 0,66 t i én postering
    // kan dækkes af 0,67 t.
    policy: "block",
    remaining: 0.67,
    balance: "40 min",
    clipSizeMinutes: 20,
    entryHours: 0.33,
    selectBoth: true,
    summary: "2 valgt, 40 min",
    // Regression: rækken viser hundrededele, så 0,33 t ikke ligner 20 min.
    rowHours: "0,33 t",
    confirmation: null,
    warning:
      "De valgte posteringer trækker 0,68 t efter afrunding. Der er 0,67 t tilbage, men saldoen dækker højst 0,67 t i én postering.",
  },
  {
    // Regression: seks klip på 24 min er præcis 2,40 t, så saldoen på 2,4 t
    // dækker en postering på 2,40 t; 2,41 t koster syv klip.
    policy: "block",
    remaining: 2.4,
    balance: "2 t 24 min",
    clipSizeMinutes: 24,
    entryHours: 2.41,
    summary: "1 valgt, 2 t 25 min",
    confirmation: null,
    warning:
      "De valgte posteringer trækker 2 t 48 min efter afrunding. Der er 2 t 24 min tilbage, men saldoen dækker højst 2 t 24 min i én postering.",
  },
  {
    // Regression: ét klip på 132 min er 2,20 t; ceil(132/60) gav 2,21 t, så
    // dialogen påstod, at saldoen ikke dækkede ét klip.
    policy: "block",
    remaining: 2.2,
    balance: "2 t 12 min",
    clipSizeMinutes: 132,
    entryHours: 2.21,
    summary: "1 valgt, 2 t 13 min",
    confirmation: null,
    warning:
      "De valgte posteringer trækker 4 t 24 min efter afrunding. Der er 2 t 12 min tilbage, men saldoen dækker højst 2 t 12 min i én postering.",
  },
  {
    // Regression: time_entries.hours er numeric(5,2), så én postering kan
    // højst være 999,99 t, selv om saldoen er større.
    policy: "block",
    remaining: 1000,
    balance: "1000 t",
    entryHours: 600,
    selectBoth: true,
    summary: "2 valgt, 1200 t",
    confirmation: null,
    warning: "men saldoen dækker højst 999,99 t i én postering.",
  },
  {
    policy: "invoice",
    remaining: 0.25,
    balance: "15 min",
    confirmation:
      "Før 0,25 timer tilbage til Efterårskort. 0,17 timer bliver fakturerbare uden klippekort.",
  },
])(
  "shows projects and confirms the outcome under $policy",
  async ({
    policy,
    remaining,
    balance,
    clipSizeMinutes = 30,
    entryHours = 0.17,
    selectBoth,
    summary,
    rowHours,
    confirmation,
    warning,
  }) => {
    assign.mockClear();
    entry.hours = entryHours;
    unlinkedEntry.hours = entryHours;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () =>
        root.render(
          <NextIntlClientProvider
            locale="da"
            timeZone="UTC"
            messages={{ common, home, klippekort, reports, time, ui }}
          >
            <AssignEntriesModal
              isOpen
              onClose={vi.fn()}
              packageId="new-card"
              packageName="Vinterkort"
              remainingHours={remaining}
              clipSizeMinutes={clipSizeMinutes}
              overdraftPolicy={policy}
              onAssigned={vi.fn()}
            />
          </NextIntlClientProvider>,
        ),
      );
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog?.textContent).toContain(
        "Tiden bliver på projektet. Den trækkes kun fra klippekortets saldo.",
      );
      expect(dialog?.textContent).not.toContain(entry.prepaidPackageName);
      const flag = dialog?.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      expect(flag?.parentElement?.textContent).toContain(
        "Vis også tid på andre klippekort",
      );
      await act(async () => flag?.click());
      expect(dialog?.textContent).toContain(entry.prepaidPackageName);
      expect(dialog?.textContent).toContain(entry.projectName);
      expect(dialog?.querySelector("select")?.textContent).toContain(
        entry.projectName,
      );
      await act(async () =>
        dialog
          ?.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')
          ?.click(),
      );
      if (selectBoth) {
        await act(async () =>
          dialog
            ?.querySelectorAll<HTMLInputElement>(
              'tbody input[type="checkbox"]',
            )[1]
            ?.click(),
        );
      }
      expect(dialog?.textContent).toContain(
        summary ?? (selectBoth ? "2 valgt, 20 min" : "1 valgt, 10 min"),
      );
      expect(dialog?.textContent).toContain(
        `Saldo efter tilknytning: ${balance}`,
      );
      if (rowHours) {
        expect(
          dialog?.querySelector("tbody tr td:last-child")?.textContent,
        ).toBe(rowHours);
      }

      if (confirmation === null) {
        expect(dialog?.querySelector('[role="status"]')?.textContent).toContain(
          warning,
        );
        expect(dialog?.textContent).toContain(
          "Tillad overtræk under Rediger på klippekortet.",
        );
        expect(dialog?.textContent).not.toContain("Vælg færre posteringer");
        if (warning.includes("i én postering")) {
          expect(dialog?.textContent).toContain(
            "Trækket beregnes for hver postering for sig",
          );
        }
        return;
      }

      if (policy === "block") {
        await act(async () =>
          dialog
            ?.querySelectorAll<HTMLInputElement>(
              'tbody input[type="checkbox"]',
            )[1]
            ?.click(),
        );
      }

      const clickButton = async (label: string) => {
        const button = Array.from(
          dialog?.querySelectorAll("button") ?? [],
        ).find((button) => button.textContent === label);
        expect(button).toBeDefined();
        await act(async () => button?.click());
      };
      await clickButton("Gennemgå flytning");
      expect(dialog?.textContent).toContain(confirmation);
      if (policy === "block") {
        expect(dialog?.textContent).toContain(
          "Tilknyt 0,17 timer uden klippekort til Vinterkort",
        );
      }
      if (policy === "invoice") {
        expect(dialog?.textContent).not.toContain(
          "træk 0,5 timer fra Vinterkort",
        );
      }
      expect(assign).not.toHaveBeenCalled();
      await clickButton("Bekræft");
      expect(assign).toHaveBeenCalledWith({
        packageId: "new-card",
        timeEntryIds:
          policy === "block" ? [entry.id, unlinkedEntry.id] : [entry.id],
      });
    } finally {
      await act(async () => root.unmount());
      entry.hours = 0.17;
      unlinkedEntry.hours = 0.17;
      vi.unstubAllGlobals();
    }
  },
);

it.each([
  ["Allow card", "Resten registreres som overtræk.", false],
  ["Block card", "overtræk er slået fra.", true],
])(
  "uses the policy returned for %s in the bulk assignment preview",
  async (name, warning, disabled) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = createRoot(document.createElement("div"));
    try {
      await act(async () =>
        root.render(
          <NextIntlClientProvider
            locale="da"
            timeZone="UTC"
            messages={{ common, home, klippekort, reports, time, ui }}
          >
            <BulkAssignPrepaidModal
              isOpen
              timeEntryIds={[unlinkedEntry.id]}
              onClose={vi.fn()}
              onAssigned={vi.fn()}
            />
          </NextIntlClientProvider>,
        ),
      );
      const button = (text: string) =>
        [
          ...document.querySelectorAll<HTMLButtonElement>(
            '[role="dialog"] button',
          ),
        ].find((candidate) => candidate.textContent?.includes(text));
      const card = button(name);
      expect(card).toBeDefined();
      await act(async () => card?.click());
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        warning,
      );
      expect(button(klippekort.assign.submit)?.disabled).toBe(disabled);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
