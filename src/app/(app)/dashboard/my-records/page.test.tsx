import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: { entries: [] as unknown[], nextOffset: null },
  isLoading: false,
  error: null as unknown,
}));
vi.mock("@/components/dashboard-nav", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    useUtils: () => ({}),
    time: { myRecords: { useQuery: () => ({ ...state, refetch: vi.fn() }) } },
  },
}));

import MyRecordsPage from "./page";

beforeEach(() => {
  state.data = { entries: [], nextOffset: null };
  state.isLoading = false;
  state.error = null;
});
it("shows filters, both exports, empty state and retention policy", () => {
  const html = renderToStaticMarkup(<MyRecordsPage />);
  for (const text of [
    "Mine registreringer",
    "Hele året",
    "Hent CSV",
    "Hent PDF",
    "Ingen registreringer",
    "/databehandleraftale",
  ])
    expect(html).toContain(text);
});
it("announces loading and disables exports", () => {
  state.isLoading = true;
  expect(renderToStaticMarkup(<MyRecordsPage />)).toContain('role="status"');
});
it("offers retry on failure", () => {
  state.error = new Error("unavailable");
  const html = renderToStaticMarkup(<MyRecordsPage />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("Prøv igen");
});
it("shows raw hours and escapes descriptions", () => {
  state.data.entries = [
    {
      id: "one",
      date: new Date("2020-01-02Z"),
      hours: "1.25",
      description: "<script>",
    },
  ];
  const html = renderToStaticMarkup(<MyRecordsPage />);
  expect(html).toContain("02.01.2020");
  expect(html).toContain("1,25");
  expect(html).toContain("&lt;script&gt;");
});
