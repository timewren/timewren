import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARROW_MAX_WIDTH, useNarrowLayout } from "../useNarrowLayout";

/**
 * Vinduet var appens eneste ukendte mål.
 *
 * Før denne hook vidste intet i appen hvor bredt vinduet var: sidebarens
 * hover-udvidelse tog de samme 164 px i et vindue på 800 px som i et på
 * 2560 px, og `p-6` var 48 px uanset hvad. Derfor dømmer testen tre ting der en
 * `matchMedia`-smule ville være sluppet forbi:
 *
 * 1. **Grænsen er grænsen.** Præcis `NARROW_MAX_WIDTH` er bred, et pixel
 *    under er smalt — ikke «måske ved 1000».
 * 2. **Et resize over grænsen skifter.** Ellers ville kun det første kald
 *    tælle, og brugeren trækker vinduet mens han kigger.
 * 3. **Opsætningen lytter igen efter en render.** Ellers ville en streng,
 *    der renderer bredden ind i en afledt værdi, lå fast ved den første.
 */
function setBredde(px: number) {
  Object.defineProperty(window, "innerWidth", {
    value: px,
    configurable: true,
    writable: true,
  });
}

function resizeTil(px: number) {
  setBredde(px);
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function Probe() {
  const smalt = useNarrowLayout();
  return <span data-testid="layout">{smalt ? "smalt" : "bredt"}</span>;
}

const ORIGINAL_INNER_WIDTH = window.innerWidth;

beforeEach(() => {
  setBredde(NARROW_MAX_WIDTH);
});

afterEach(() => {
  cleanup();
  setBredde(ORIGINAL_INNER_WIDTH);
});

describe("useNarrowLayout", () => {
  it("måler det vindue appen faktisk har, ikke bredden i en browser", () => {
    resizeTil(900);
    render(<Probe />);
    // jsdoms forvalgte `innerWidth` er 1024. Uden `setBredde` ville denne test
    // være grøn i et bredt layout og aldrig se den smalle.
    expect(screen.getByTestId("layout").textContent).toBe("smalt");
  });

  it("lader præcis grænsen være bred og et pixel under være smal", () => {
    resizeTil(NARROW_MAX_WIDTH);
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId("layout").textContent).toBe("bredt");

    resizeTil(NARROW_MAX_WIDTH - 1);
    expect(screen.getByTestId("layout").textContent).toBe("smalt");

    unmount();
    resizeTil(NARROW_MAX_WIDTH + 1);
    render(<Probe />);
    expect(screen.getByTestId("layout").textContent).toBe("bredt");
  });

  it("skifter mode, når brugeren trækker vinduet over grænsen", () => {
    resizeTil(1400);
    render(<Probe />);
    expect(screen.getByTestId("layout").textContent).toBe("bredt");

    resizeTil(820);
    expect(screen.getByTestId("layout").textContent).toBe("smalt");

    resizeTil(1400);
    expect(screen.getByTestId("layout").textContent).toBe("bredt");
  });

  it("læser bredden igen, fordi et resize mellem render og effekt er tabt", () => {
    // Resize-hændelsen kan lande **før** effekten har monteret lytteren, og så
    // er den væk — den bliver ikke afsendt igen. Uden genlæsningen står appen
    // med den bredde den havde da den startede, selv om vinduet siden er blevet
    // trukket et andet sted. Getteren tæller derfor aflæsninger: den første er
    // initialiseringen, den anden er effekten.
    let aflæsninger = 0;
    Object.defineProperty(window, "innerWidth", {
      get: () => (++aflæsninger === 1 ? 1400 : 900),
      configurable: true,
    });

    render(<Probe />);
    expect(screen.getByTestId("layout").textContent).toBe("smalt");
    expect(aflæsninger).toBeGreaterThanOrEqual(2);
  });

  it("tager kun en resize der krydser grænsen", () => {
    const renders = vi.fn();
    resizeTil(1400);
    function Talt() {
      renders();
      return <Probe />;
    }
    render(<Talt />);
    const før = renders.mock.calls.length;

    // 40 pixels ad gangen under grænsen: hooken gemmer sandt/falsk, så
    // appen må ikke male hele ruten for hvert pixel under trækningen.
    for (let px = 1390; px >= 1060; px -= 10) resizeTil(px);
    expect(renders.mock.calls.length).toBe(før);

    resizeTil(1050);
    expect(screen.getByTestId("layout").textContent).toBe("smalt");
    const efterKrydsning = renders.mock.calls.length;
    for (let px = 1050; px >= 1010; px -= 10) resizeTil(px);
    expect(renders.mock.calls.length).toBe(efterKrydsning);
  });

  it("løfter lytteren op igen, når komponenten forsvinder", () => {
    const fjern = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<Probe />);
    unmount();
    expect(fjern).toHaveBeenCalledWith("resize", expect.any(Function));

    resizeTil(900);
    // Efter unmount må ingen lytter være tilbage — ellers fortsætter
    // kaldssteder at sætte tilstand på en afmonteret komponent.
    expect(() => resizeTil(1400)).not.toThrow();
    fjern.mockRestore();
  });
});
