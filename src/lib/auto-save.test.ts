import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AutoSaveController, zodFieldValidator } from "./auto-save";

type Form = Record<string, unknown> & {
  name: string;
  rate: string;
  rounding: boolean;
};

const initial: Form = { name: "Anders", rate: "750", rounding: false };

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lader afventende promise-kæder køre færdig. */
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("AutoSaveController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gemmer tekstfelter først efter pausen, med kun det sidste tastetryk", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = new AutoSaveController<Form>({ initial, save, debounceMs: 700 });

    c.set("rate", "8", "debounce");
    await vi.advanceTimersByTimeAsync(300);
    c.set("rate", "80", "debounce");
    await vi.advanceTimersByTimeAsync(300);
    c.set("rate", "800", "debounce");
    await vi.advanceTimersByTimeAsync(699);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual({ rate: "800" });
  });

  it("flush (blur) gemmer med det samme", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = new AutoSaveController<Form>({ initial, save });
    c.set("name", "Anders J", "debounce");
    c.flush();
    expect(save).toHaveBeenCalledWith({ name: "Anders J" }, expect.anything());
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("toggles gemmer med det samme og sender kun ændrede felter", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = new AutoSaveController<Form>({ initial, save });
    c.set("rounding", true, "now");
    expect(save).toHaveBeenCalledWith(
      { rounding: true },
      { ...initial, rounding: true },
    );
  });

  it("sender intet, når værdien er den gemte igen", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = new AutoSaveController<Form>({ initial, save });
    c.set("rate", "751", "debounce");
    c.set("rate", "750", "debounce");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(c.getSnapshot().busy).toBe(false);
  });

  it("ugyldige felter viser fejlen og gemmes ikke", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const validate = zodFieldValidator<Form>({
      name: z.string().min(2, "Navn skal være mindst 2 tegn"),
    });
    const c = new AutoSaveController<Form>({ initial, save, validate });

    c.set("name", "A", "debounce");
    c.flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
    expect(c.getSnapshot().errors.name).toBe("Navn skal være mindst 2 tegn");
    expect(c.getSnapshot().values.name).toBe("A");

    c.set("name", "Ab", "now");
    expect(c.getSnapshot().errors.name).toBeUndefined();
    expect(save).toHaveBeenCalledWith({ name: "Ab" }, expect.anything());
  });

  it("køer ændringer, så et gammelt svar ikke overskriver en nyere værdi", async () => {
    const calls: { patch: Partial<Form>; d: ReturnType<typeof deferred> }[] =
      [];
    const save = vi.fn((patch: Partial<Form>) => {
      const d = deferred();
      calls.push({ patch, d });
      return d.promise;
    });
    const c = new AutoSaveController<Form>({ initial, save });

    c.set("rounding", true, "now");
    c.set("rounding", false, "now");
    c.set("rate", "900", "now");
    // Kun ét kald ad gangen
    expect(calls).toHaveLength(1);

    calls[0].d.resolve();
    await tick();
    // Det næste kald har de seneste værdier samlet
    expect(calls).toHaveLength(2);
    expect(calls[1].patch).toEqual({ rounding: false, rate: "900" });

    calls[1].d.resolve();
    await tick();
    expect(c.getSnapshot().values).toEqual({
      ...initial,
      rounding: false,
      rate: "900",
    });
    expect(c.getSnapshot().status).toBe("saved");
  });

  it("ruller tilbage ved fejl og kan prøve igen", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Serverfejl"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const c = new AutoSaveController<Form>({ initial, save, onError });

    c.set("rate", "999", "now");
    expect(c.getSnapshot().values.rate).toBe("999"); // optimistisk
    await tick();

    expect(c.getSnapshot().values.rate).toBe("750");
    expect(c.getSnapshot().status).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);

    const retry = onError.mock.calls[0][1] as () => void;
    retry();
    expect(c.getSnapshot().values.rate).toBe("999");
    await tick();
    expect(save).toHaveBeenLastCalledWith({ rate: "999" }, expect.anything());
    expect(c.getSnapshot().status).toBe("saved");
    expect(c.getSnapshot().values.rate).toBe("999");
  });

  it("ruller ikke et felt tilbage, som brugeren har ændret undervejs", async () => {
    const d = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(d.promise)
      .mockResolvedValue(undefined);
    const c = new AutoSaveController<Form>({ initial, save });

    c.set("rate", "800", "now");
    c.set("rate", "850", "debounce");
    d.reject(new Error("nede"));
    await tick();
    expect(c.getSnapshot().values.rate).toBe("850");

    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenLastCalledWith({ rate: "850" }, expect.anything());
  });

  it("'Gemt' forsvinder efter 2 sekunder", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = new AutoSaveController<Form>({ initial, save });
    c.set("rounding", true, "now");
    expect(c.getSnapshot().status).toBe("saving");
    await tick();
    expect(c.getSnapshot().status).toBe("saved");
    await vi.advanceTimersByTimeAsync(1999);
    expect(c.getSnapshot().status).toBe("saved");
    await vi.advanceTimersByTimeAsync(1);
    expect(c.getSnapshot().status).toBe("idle");
  });

  it("busy er sand, mens en ændring venter eller sendes (navigationsadvarsel)", async () => {
    const d = deferred();
    const save = vi.fn().mockReturnValue(d.promise);
    const c = new AutoSaveController<Form>({ initial, save });
    expect(c.getSnapshot().busy).toBe(false);
    c.set("name", "Bente", "debounce");
    expect(c.getSnapshot().busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalled();
    expect(c.getSnapshot().busy).toBe(true);
    d.resolve();
    await tick();
    expect(c.getSnapshot().busy).toBe(false);
  });

  it("reset fylder formularen, men ikke mens en ændring er i gang", () => {
    const save = vi.fn(() => new Promise<void>(() => {}));
    const c = new AutoSaveController<Form>({ initial, save });
    c.reset({ name: "Fra server", rate: "500", rounding: true });
    expect(c.getSnapshot().values.name).toBe("Fra server");

    c.set("rate", "600", "now");
    c.reset({ name: "Igen", rate: "1", rounding: false });
    expect(c.getSnapshot().values.rate).toBe("600");
  });
});

describe("AutoSaveController (atomisk formular)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  type Week = Record<string, unknown> & { mon: string; tue: string };
  const week: Week = { mon: "7,4", tue: "7,4" };
  const validate = (_key: keyof Week, _v: unknown, values: Week) => {
    const n = (s: string) => Number(s.replace(",", "."));
    if ([values.mon, values.tue].some((v) => Number.isNaN(n(v))))
      return "Skriv et tal";
    return n(values.mon) + n(values.tue) > 0 ? null : "Mindst én dag";
  };

  it("sender intet, mens et felt er ugyldigt, og alt samlet bagefter", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const c = new AutoSaveController<Week>({
      initial: week,
      save,
      validate,
      atomic: true,
    });
    c.set("mon", "0", "now");
    c.set("tue", "x", "now");
    await tick();
    // mandag blev sendt før tirsdag blev ugyldig
    expect(save).toHaveBeenCalledTimes(1);
    c.set("tue", "0", "now");
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().errors.mon).toBe("Mindst én dag");

    c.setMany({ mon: "8", tue: "8" }, "now");
    await tick();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ mon: "8", tue: "8" });
    expect(c.getSnapshot().errors).toEqual({});
  });
});

describe("AutoSaveController (fejl og nulstilling)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("en senere gemning af et andet felt sletter ikke 'Prøv igen' for det fejlede", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("nede"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const c = new AutoSaveController<Form>({ initial, save, onError });
    c.set("rate", "999", "now");
    await tick();
    c.set("rounding", true, "now");
    await tick();
    expect(c.getSnapshot().status).toBe("error");

    (onError.mock.calls[0][1] as () => void)();
    await tick();
    expect(save).toHaveBeenLastCalledWith({ rate: "999" }, expect.anything());
    expect(c.getSnapshot().status).toBe("saved");
  });

  it("tvungen reset kasserer svaret fra et kørende kald og en gammel fejl", async () => {
    let resolve!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const c = new AutoSaveController<Form>({ initial, save });
    c.set("rate", "999", "now");
    expect(c.reset({ ...initial, rate: "100" }, { force: true })).toBe(true);
    resolve();
    await tick();
    expect(c.getSnapshot().values.rate).toBe("100");
    expect(c.getSnapshot().status).toBe("idle");
    expect(c.getSnapshot().busy).toBe(false);
    // Næste ændring sammenlignes med den nulstillede værdi
    c.set("rate", "100", "now");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("reset uden force afvises, mens brugeren er i gang", () => {
    const save = vi.fn(() => new Promise<void>(() => {}));
    const c = new AutoSaveController<Form>({ initial, save });
    c.set("rate", "600", "debounce");
    expect(c.reset({ ...initial, rate: "1" })).toBe(false);
  });

  it("et fejlet felt, som brugeren selv ændrer bagefter, prøves ikke igen", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("nede"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const c = new AutoSaveController<Form>({ initial, save, onError });
    c.set("rate", "999", "now");
    await tick();
    c.set("rate", "800", "now");
    await tick();
    expect(c.getSnapshot().status).toBe("saved");
    (onError.mock.calls[0][1] as () => void)();
    expect(c.getSnapshot().values.rate).toBe("800");
    expect(save).toHaveBeenCalledTimes(2);
  });
});
