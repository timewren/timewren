import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip } from "../Tooltip";

/**
 * Tooltip'en lægger handlerne på barnet med `cloneElement`.
 *
 * Det er den rigtige form — en `<span>` med muse-handlere kan hverken få
 * fokus eller tastatur, så knappen ville miste sit navn for skærmlæseren.
 * Prisen er, at `cloneElement` **overskriver** de handlers barnet selv har,
 * og det er den pris der skal dømmes: en tooltip der spiser knappens `onClick`
 * eller dens `onKeyDown` tager navigationen med sig.
 */
afterEach(cleanup);

function renderMedKnap(egne?: Record<string, () => void>) {
  render(
    <Tooltip label="Tidslinje">
      <button type="button" {...egne}>
        <span>Ikon</span>
      </button>
    </Tooltip>,
  );
  return screen.getByRole("button");
}

describe("Tooltip", () => {
  it("lader barnets egne handlers leve videre", () => {
    const onClick = vi.fn();
    const knap = renderMedKnap({ onClick });
    fireEvent.click(knap);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("kalder barnets egen tastatur-handler, før den lukker tooltip'en", () => {
    const onKeyDown = vi.fn();
    const knap = renderMedKnap({ onKeyDown });
    fireEvent.keyDown(knap, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    // Enter skal ikke lukke den — brugeren kan stå og læse, mens han
    // bekræfter noget i knappen.
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lukker på Escape, men lader barnet se tasten", () => {
    const onKeyDown = vi.fn();
    const knap = renderMedKnap({ onKeyDown });
    fireEvent.mouseEnter(knap);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.keyDown(knap, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("rydder beskrivelsen op, når tooltip'en forsvinder", () => {
    const knap = renderMedKnap();
    fireEvent.mouseEnter(knap);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(knap);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // Der skal ikke blive en `aria-describedby` hængende på en knap, der
    // ingen beskrivelse har — skærmlæseren ville læse et tomt felt.
    expect(knap.getAttribute("aria-describedby")).toBeNull();
  });
});
