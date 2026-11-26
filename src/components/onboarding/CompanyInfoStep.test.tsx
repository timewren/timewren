// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CompanyInfoStep } from "./CompanyInfoStep";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onNext = vi.fn();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onNext.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(
  initialData?: Parameters<typeof CompanyInfoStep>[0]["initialData"],
) {
  act(() => {
    root.render(
      <CompanyInfoStep
        onNext={onNext}
        onBack={() => {}}
        initialData={{
          name: "Moms ApS",
          email: "firma@moms.test",
          ...initialData,
        }}
      />,
    );
  });
}

const input = (id: string) =>
  container.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
const vatBox = () => input("vatRegistered");

/** Taster en værdi i et kontrolleret felt, som React ser det. */
function type(id: string, value: string) {
  const el = input(id);
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

function submit() {
  act(() => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  return onNext.mock.calls.at(-1)?.[0];
}

describe("CompanyInfoStep: momsfluebenet", () => {
  it("et dansk CVR slår det til; valget overlades til serveren", () => {
    render();
    expect(vatBox().checked).toBe(false);
    type("cvrNumber", "12345678");
    expect(vatBox().checked).toBe(true);
    expect(submit()).not.toHaveProperty("vatRegistered");
  });

  // Greptile P1 2
  it("Danmark skrevet om til Denmark: slået til igen", () => {
    render();
    type("cvrNumber", "12345678");
    type("country", "Den");
    expect(vatBox().checked).toBe(false);
    type("country", "Denmark");
    expect(vatBox().checked).toBe(true);
  });

  it("brugerens fravalg står, også når landet skrives om", () => {
    render();
    type("cvrNumber", "12345678");
    click(vatBox());
    expect(vatBox().checked).toBe(false);
    type("country", "Den");
    type("country", "Denmark");
    expect(vatBox().checked).toBe(false);
    expect(submit()).toMatchObject({ vatRegistered: false });
  });

  it("et gemt valg fra profilen står, når CVR'et skrives om", () => {
    render({
      cvrNumber: "12345678",
      vatRegistered: false,
      vatRegisteredChosen: true,
    });
    type("cvrNumber", "1234567");
    type("cvrNumber", "12345678");
    expect(vatBox().checked).toBe(false);
    expect(submit()).toMatchObject({ vatRegistered: false });
  });

  // Greptile P1 3
  it("et opslag, der lander efter brugerens valg, ændrer det ikke", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      ),
    );
    render();
    type("cvrNumber", "Moms ApS");
    const lookup = input("cvrNumber")
      .closest("div")
      ?.querySelector("button") as HTMLButtonElement;
    click(lookup);
    click(vatBox());
    click(vatBox());
    expect(vatBox().checked).toBe(false);
    await act(async () => {
      answer({
        ok: true,
        json: async () => ({
          name: "Moms ApS",
          cvrNumber: "12345678",
          vatNumber: "DK12345678",
        }),
      });
    });
    expect(input("cvrNumber").value).toBe("12345678");
    expect(vatBox().checked).toBe(false);
    expect(submit()).toMatchObject({ vatRegistered: false });
  });

  it("et opslag uden brugerens valg slår det til", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ name: "Moms ApS", cvrNumber: "12345678" }),
      })),
    );
    render();
    type("cvrNumber", "Moms ApS");
    const lookup = input("cvrNumber")
      .closest("div")
      ?.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      lookup.click();
    });
    expect(vatBox().checked).toBe(true);
  });
});
