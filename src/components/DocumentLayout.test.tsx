import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Schibsted_Grotesk: () => ({ variable: "f1", className: "f1" }),
  Geist_Mono: () => ({ variable: "f2", className: "f2" }),
}));
vi.mock("@/app/globals.css", () => ({}));
// Async serverkomponent (getTranslations); renderToStaticMarkup kan ikke vente på den.
vi.mock("@/components/CookieConsent", () => ({ CookieConsent: () => null }));

describe("DocumentLayout", () => {
  it("indlæser /runtime-config.js synkront først i <head>", async () => {
    const { DocumentLayout } = await import("./DocumentLayout");
    const html = renderToStaticMarkup(
      <DocumentLayout locale="da">x</DocumentLayout>,
    );
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    const tag = '<script src="/runtime-config.js"></script>';
    // Synkront (ingen async/defer) og før det første andet script i <head>.
    expect(head).toContain(tag);
    expect(head.indexOf(tag)).toBe(head.indexOf("<script"));
  });
});
