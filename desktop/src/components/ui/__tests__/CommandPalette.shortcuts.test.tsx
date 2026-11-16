import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

const invoke = vi.fn(async () => null);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) =>
    (invoke as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { CommandPalette } from "../CommandPalette";

afterEach(cleanup);

function press(key: string, target: HTMLElement = document.body) {
  fireEvent.keyDown(target, { key });
}

describe("? som åbner genvejsoversigten", () => {
  it("åbner oversigten, når der trykkes på spørgsmålstegn", () => {
    render(<CommandPalette />);
    expect(screen.queryByText("Overalt")).toBeNull();

    press("?");

    expect(screen.getByText("Overalt")).toBeTruthy();
  });

  it("gør intet når der skrives i et felt", () => {
    render(<CommandPalette />);
    const felt = document.createElement("input");
    document.body.appendChild(felt);

    press("?", felt);

    expect(screen.queryByText("Overalt")).toBeNull();
    felt.remove();
  });

  it("gør intet når en anden dialog allerede er åben", () => {
    render(<CommandPalette />);
    // A dialog that is not ours — the overview must not land on top of it.
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    document.body.appendChild(other);

    press("?");

    expect(screen.queryByText("Overalt")).toBeNull();
    other.remove();
  });
});
