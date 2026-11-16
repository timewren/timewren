import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useListKeyboard } from "../useListKeyboard";

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key,
    ...init,
  });
}

afterEach(cleanup);

describe("useListKeyboard", () => {
  it("kalder onHorizontal med -1/1 for venstre/højre pil", () => {
    const onHorizontal = vi.fn();
    renderHook(() => useListKeyboard({ itemCount: 3, onHorizontal }));

    press("ArrowLeft");
    press("ArrowRight");

    expect(onHorizontal.mock.calls).toEqual([[-1], [1]]);
  });

  it("lader pile-taster skifte dag også på en tom dag", () => {
    // Dagen skifter med vilje, også når dagen ingen registreringer har — ellers
    // sidder brugeren fast på en tom dag.
    const onHorizontal = vi.fn();
    renderHook(() => useListKeyboard({ itemCount: 0, onHorizontal }));

    press("ArrowRight");

    expect(onHorizontal).toHaveBeenCalledWith(1);
  });

  it("lader ikke pile-taster stjæle, når kalderen ikke vil have dem", () => {
    const { result } = renderHook(() => useListKeyboard({ itemCount: 3 }));
    press("ArrowRight");
    expect(result.current.activeIndex).toBe(-1);
  });

  it("navigerer frem og tilbage med j/k og holder sig i listen", () => {
    const { result } = renderHook(() => useListKeyboard({ itemCount: 3 }));

    press("j");
    expect(result.current.activeIndex).toBe(0);
    press("j");
    press("j");
    expect(result.current.activeIndex).toBe(2);
    press("j");
    expect(result.current.activeIndex).toBe(2);
    press("k");
    expect(result.current.activeIndex).toBe(1);
  });

  it("lader ikke j/k stjæle tastaturet, mens der skrives i et felt", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useListKeyboard({ itemCount: 3, onSelect }),
    );
    press("j");
    expect(result.current.activeIndex).toBe(0);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "j" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(result.current.activeIndex).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();
    input.remove();
  });

  it("gør intet i en tom liste uden at kaste", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() =>
      useListKeyboard({ itemCount: 0, onSelect }),
    );
    press("j");
    press("Enter");
    press("d");
    expect(result.current.activeIndex).toBe(-1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
