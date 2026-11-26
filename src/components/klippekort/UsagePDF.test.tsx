import { type DocumentProps, renderToBuffer } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import { cloneElement, createElement, type ReactElement } from "react";
import { expect, it } from "vitest";
import klippekort from "@/i18n/messages/en/klippekort.json";
import { usageExportRows } from "@/lib/prepaid/usage-export";
import { UsagePDF } from "./UsagePDF";

it("keeps every line of a long description within the PDF pages", async () => {
  type LayoutNode = {
    type: string;
    box?: { top: number; height: number };
    children?: LayoutNode[];
    lines?: { string: string; box: { y: number; height: number } }[];
  };
  let layout: LayoutNode | undefined;
  const document = UsagePDF({
    name: "Testkort",
    rows: usageExportRows(
      [
        {
          id: "long",
          date: "2026-03-01",
          description: Array(100).fill("abc").join("\n"),
          hoursUsed: "1.25",
        },
      ],
      false,
    ),
  });
  await renderToBuffer(
    cloneElement(document, {
      onRender: (props: { _INTERNAL__LAYOUT__DATA_?: LayoutNode }) => {
        layout = props._INTERNAL__LAYOUT__DATA_;
      },
    }),
  );
  expect(layout?.children?.length).toBeGreaterThan(1);
  const descriptionLines: string[] = [];
  for (const page of layout?.children ?? []) {
    const visit = (node: LayoutNode, top: number) => {
      if (!node.box) return;
      const absoluteTop = top + node.box.top;
      for (const line of node.lines ?? []) {
        if (line.string.trim() === "abc") {
          descriptionLines.push(line.string.trim());
          expect(
            absoluteTop +
              line.box.y -
              (node.lines?.[0]?.box.y ?? 0) +
              line.box.height,
          ).toBeLessThanOrEqual(page.box?.height ?? 0);
        }
      }
      for (const child of node.children ?? []) visit(child, absoluteTop);
    };
    for (const child of page.children ?? []) visit(child, 0);
  }
  expect(descriptionLines).toHaveLength(100);
}, 30000);

it("renders a multipage history with Danish text using embedded fonts", async () => {
  const rows = usageExportRows(
    Array.from({ length: 150 }, (_, index) => ({
      id: `usage-${index}`,
      date: "2026-03-01",
      description: "Møde om ændringer",
      hoursUsed: "1.25",
    })),
    false,
  );
  const buffer = await renderToBuffer(
    createElement(UsagePDF, {
      name: "Testkort",
      rows,
    }) as ReactElement<DocumentProps>,
  );
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    buffer.toString("latin1").match(/\/Type \/Page\b/g)?.length,
  ).toBeGreaterThan(1);
}, 30000);

it("renders localized EUR usage amounts and preserves the existing DKK PDF", () => {
  const t = createTranslator({
    locale: "en",
    messages: { klippekort },
    namespace: "klippekort",
  });
  const rows = usageExportRows(
    [
      {
        id: "usage",
        date: "2026-03-01",
        description: "Artwork review",
        hoursUsed: "1.50",
        valueUsed: "142.50",
      },
    ],
    true,
  );
  const demoText = JSON.stringify(
    UsagePDF({
      name: "Prepaid 10 hours",
      rows,
      language: {
        locale: "en",
        title: t("detail.history"),
        date: t("usagePdf.date"),
        description: t("usagePdf.description"),
        hours: t("usagePdf.hours"),
        value: t("usagePdf.value", { currency: "EUR" }),
      },
    }),
  );
  expect(demoText).toContain("Value (EUR)");
  expect(demoText).toContain("142.50");
  expect(demoText).toContain("1.50");

  const legacyText = JSON.stringify(UsagePDF({ name: "Testkort", rows }));
  expect(legacyText).toContain("Værdi (kr)");
  expect(legacyText).toContain("142,50");
});
