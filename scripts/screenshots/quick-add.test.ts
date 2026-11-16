import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import messages from "../../src/i18n/messages/en/tasks.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown>)[part],
        messages,
      ),
}));
vi.mock("@/hooks/useModules", () => ({
  useModules: () => ({ isEnabled: () => true, isPlaceholder: false }),
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    projects: { list: { useQuery: () => ({ data: [] }) } },
    clients: { list: { useQuery: () => ({ data: [] }) } },
    tasks: { create: { useMutation: () => ({ isPending: false }) } },
    useUtils: () => ({}),
  },
}));
vi.mock("@/stores/taskPreferencesStore", () => ({
  useTaskPreferencesStore: () => ({}),
}));
vi.mock("@/components/tasks/QuickAddPreview", () => ({
  QuickAddPreview: () => null,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each(["timewren", "timetrack"])(
  "uses the correct task placeholder for %s",
  async (brand) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", brand);
    vi.resetModules();
    const { QuickAddTask } = await import(
      "../../src/components/tasks/QuickAddTask"
    );
    const html = renderToStaticMarkup(createElement(QuickAddTask));
    if (brand === "timewren") {
      expect(html).toContain("Title of the new task...");
      expect(html).not.toContain("Design forside");
    } else {
      expect(html).toContain("Design forside");
    }
  },
);
