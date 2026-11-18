import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import da from "@/i18n/messages/da/adminShell.json";
import { TestAccountFilter } from "../TestAccountFilter";

const pathname = vi.hoisted(() => ({ value: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const render = (path: string) => {
  pathname.value = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="da" messages={{ adminShell: da }}>
      <TestAccountFilter>
        <p>indhold</p>
      </TestAccountFilter>
    </NextIntlClientProvider>,
  );
};

describe("TestAccountFilter", () => {
  it("shows the checkbox on the prospects page", () => {
    expect(render("/admin/prospects")).toContain('type="checkbox"');
  });

  it("hides the checkbox on pages without metrics", () => {
    expect(render("/admin/settings")).not.toContain('type="checkbox"');
  });
});
