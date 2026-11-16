// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { downloadCSV } from "@/lib/utils/csv-export";
import { UsageExport } from "./UsageExport";

vi.mock("@/lib/utils/csv-export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/csv-export")>()),
  downloadCSV: vi.fn(),
}));

const container = document.createElement("div");
const root = createRoot(container);
afterEach(async () => {
  await act(async () => root.render(null));
  vi.clearAllMocks();
});

it("disables downloads for empty history", async () => {
  await act(async () =>
    root.render(
      <UsageExport packageId="card-1" packageName="Testkort" usage={[]} />,
    ),
  );
  const buttons = Array.from(container.querySelectorAll("button"));
  expect(buttons).toHaveLength(2);
  expect(buttons.every((button) => button.disabled)).toBe(true);
});

it("downloads the selected card as CSV without portal values", async () => {
  await act(async () =>
    root.render(
      <UsageExport
        packageId="card-1"
        packageName="Testkort"
        usage={[
          {
            id: "u1",
            date: "2026-03-01",
            description: "Møde",
            hoursUsed: "1.25",
            valueUsed: "625",
          },
        ]}
      />,
    ),
  );
  await act(async () => container.querySelector("button")?.click());
  expect(downloadCSV).toHaveBeenCalledWith(
    expect.stringContaining("1,25"),
    "klippekort-card-1-forbrug.csv",
  );
  expect(vi.mocked(downloadCSV).mock.calls[0][0]).not.toContain("625");
});
