/**
 * Autogem af indstillingsformularer (ingen Gem-knap).
 *
 * Ren controller uden React, så debounce, kø og tilbagerulning kan testes
 * direkte. `useAutoSave` pakker den ind til komponenter.
 *
 * - `set(key, value, "debounce")` til tekstfelter: gemmer efter en pause
 *   (og med det samme ved `flush()`, fx ved blur).
 * - `set(key, value, "now")` til toggles, selects, radio og farver.
 * - Kun felter, der afviger fra den gemte værdi og er gyldige, sendes.
 *   Ugyldige felter får en fejl og gemmes ikke.
 * - Ét kald ad gangen pr. formular. Ændringer undervejs samles og sendes
 *   bagefter, så et gammelt svar aldrig kan overskrive en nyere værdi.
 * - Fejler et kald, rulles de felter, brugeren ikke har rørt siden, tilbage
 *   til den gemte værdi, og `retry()` sender dem igen.
 */

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
export type AutoSaveMode = "debounce" | "now";
export type AutoSaveErrors<T> = Partial<Record<keyof T, string>>;

export interface AutoSaveOptions<T extends Record<string, unknown>> {
  initial: T;
  /** Sender de ændrede felter. `values` er hele formularen ved afsendelse. */
  save: (patch: Partial<T>, values: T) => Promise<unknown>;
  /** Fejlbesked for et ugyldigt felt, ellers null. */
  validate?: <K extends keyof T>(
    key: K,
    value: T[K],
    values: T,
  ) => string | null;
  /** Kaldes når et kald fejler; `retry` sender de samme felter igen. */
  onError?: (error: unknown, retry: () => void) => void;
  /**
   * Hele formularen sendes samlet (`save` bruger `values`), så intet sendes,
   * mens et felt er ugyldigt. Ellers gemmes de gyldige felter for sig.
   */
  atomic?: boolean;
  debounceMs?: number;
  /** Hvor længe "Gemt" vises, før statussen går tilbage til idle. */
  savedMs?: number;
}

export interface AutoSaveSnapshot<T> {
  values: T;
  errors: AutoSaveErrors<T>;
  status: AutoSaveStatus;
  /** Sand mens et kald kører eller en ændring venter på at blive sendt. */
  busy: boolean;
}

export const AUTO_SAVE_DEBOUNCE_MS = 700;
export const AUTO_SAVE_SAVED_MS = 2000;

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === "object" && typeof b === "object" && a && b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export class AutoSaveController<T extends Record<string, unknown>> {
  private values: T;
  private confirmed: T;
  private errors: AutoSaveErrors<T> = {};
  private status: AutoSaveStatus = "idle";
  private dirty = new Set<keyof T>();
  private inFlight = false;
  /** Felterne i det kald, der kører nu. */
  private sending: Partial<T> = {};
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFailed: Partial<T> | null = null;
  /** Tælles op ved en tvungen reset, så et kald fra før ignoreres. */
  private generation = 0;
  private listeners = new Set<() => void>();
  private snapshot: AutoSaveSnapshot<T>;

  constructor(private readonly options: AutoSaveOptions<T>) {
    this.values = { ...options.initial };
    this.confirmed = { ...options.initial };
    this.snapshot = this.buildSnapshot();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AutoSaveSnapshot<T> => this.snapshot;

  /**
   * Ny gemt værdi udefra. Uden `force` (første hentning) røres en formular
   * i gang ikke, og der svares false. Med `force` (efter "Nulstil" på
   * serveren) kasseres ventende ændringer, fejl og svaret fra et kørende kald.
   */
  reset(initial: T, { force = false }: { force?: boolean } = {}): boolean {
    if (!force && (this.busy() || this.lastFailed)) return false;
    if (force) {
      this.generation++;
      this.clearDebounce();
      this.dirty.clear();
      this.lastFailed = null;
      this.status = "idle";
    }
    this.values = { ...initial };
    this.confirmed = { ...initial };
    this.errors = {};
    this.emit();
    return true;
  }

  set<K extends keyof T>(key: K, value: T[K], mode: AutoSaveMode): void {
    this.setMany({ [key]: value } as unknown as Partial<T>, mode);
  }

  /** Flere felter på én gang (fx "nulstil"), sendt i ét kald. */
  setMany(patch: Partial<T>, mode: AutoSaveMode): void {
    this.values = { ...this.values, ...patch };
    // Et felt, brugeren selv har ændret siden fejlen, skal ikke prøves igen
    if (this.lastFailed) {
      const rest = { ...this.lastFailed };
      for (const key of Object.keys(patch)) delete rest[key];
      this.lastFailed = Object.keys(rest).length > 0 ? rest : null;
    }
    // Atomiske formularer valideres helt hver gang: et felt kan gøre et
    // andet gyldigt igen (fx "mindst én dag med arbejdstid").
    const keys = (
      this.options.atomic ? Object.keys(this.values) : Object.keys(patch)
    ) as (keyof T)[];
    const errors = { ...this.errors };
    for (const key of keys) {
      const error =
        this.options.validate?.(key, this.values[key], this.values) ?? null;
      if (error) {
        errors[key] = error;
        this.dirty.delete(key);
      } else {
        delete errors[key];
        if (key in patch || this.options.atomic) {
          if (same(this.values[key], this.target(key))) this.dirty.delete(key);
          else this.dirty.add(key);
        }
      }
    }
    this.errors = errors;

    if (mode === "now") this.flush();
    else this.schedule();
    this.emit();
  }

  /** Send ventende ændringer nu (blur, unmount). */
  flush(): void {
    this.clearDebounce();
    if (this.inFlight || this.dirty.size === 0) return;
    if (this.options.atomic && Object.keys(this.errors).length > 0) return;
    void this.send();
  }

  /** Send de felter, der fejlede sidst, igen. */
  retry(): void {
    const failed = this.lastFailed;
    if (!failed) return;
    this.lastFailed = null;
    for (const key of Object.keys(failed) as (keyof T)[]) {
      this.values = { ...this.values, [key]: failed[key] };
      if (!same(failed[key], this.confirmed[key])) this.dirty.add(key);
    }
    this.emit();
    this.flush();
  }

  dispose(): void {
    this.flush();
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.listeners.clear();
  }

  /** Værdien serveren har, når det kørende kald er færdigt. */
  private target<K extends keyof T>(key: K): T[K] {
    return key in this.sending
      ? (this.sending[key] as T[K])
      : this.confirmed[key];
  }

  private busy(): boolean {
    return this.inFlight || this.debounceTimer !== null || this.dirty.size > 0;
  }

  private schedule(): void {
    this.clearDebounce();
    if (this.dirty.size === 0) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
      this.emit();
    }, this.options.debounceMs ?? AUTO_SAVE_DEBOUNCE_MS);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  private async send(): Promise<void> {
    const patch = {} as Partial<T>;
    for (const key of this.dirty) patch[key] = this.values[key];
    this.dirty.clear();
    this.sending = patch;
    this.inFlight = true;
    this.setStatus("saving");

    const generation = this.generation;
    let failed = false;
    try {
      await this.options.save(patch, { ...this.values });
      if (generation !== this.generation) return;
      this.confirmed = { ...this.confirmed, ...patch };
      // Kun de sendte felter er nu gemt; en ældre fejl på andre felter står
      if (this.lastFailed) {
        const rest = { ...this.lastFailed };
        for (const key of Object.keys(patch)) delete rest[key];
        this.lastFailed = Object.keys(rest).length > 0 ? rest : null;
      }
    } catch (error) {
      if (generation !== this.generation) return;
      failed = true;
      // Felter, brugeren har ændret igen undervejs, får lov at stå
      const values = { ...this.values };
      for (const key of Object.keys(patch) as (keyof T)[]) {
        if (same(values[key], patch[key])) values[key] = this.confirmed[key];
      }
      this.values = values;
      this.lastFailed = { ...this.lastFailed, ...patch };
      this.setStatus("error");
      this.options.onError?.(error, () => this.retry());
    } finally {
      this.inFlight = false;
      this.sending = {};
      // Efter en tvungen reset: send det, der er ændret siden
      if (generation !== this.generation) {
        if (this.dirty.size > 0 && this.debounceTimer === null) this.flush();
        this.emit();
      }
    }

    // Ændringer, der kom undervejs, sendes nu (medmindre de venter på
    // pausen eller en atomisk formular har en fejl)
    if (this.dirty.size > 0 && this.debounceTimer === null) {
      this.flush();
      if (this.inFlight) return;
    }
    if (failed || this.lastFailed) {
      this.setStatus("error");
      return;
    }
    this.setStatus("saved");
    this.savedTimer = setTimeout(() => {
      this.savedTimer = null;
      if (this.status === "saved") this.setStatus("idle");
    }, this.options.savedMs ?? AUTO_SAVE_SAVED_MS);
  }

  private setStatus(status: AutoSaveStatus): void {
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = null;
    this.status = status;
    this.emit();
  }

  private buildSnapshot(): AutoSaveSnapshot<T> {
    return {
      values: this.values,
      errors: this.errors,
      status: this.status,
      busy: this.busy(),
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }
}

/** Feltvis validering mod et Zod-objektskemas felter. */
export function zodFieldValidator<T extends Record<string, unknown>>(
  shape: {
    [K in keyof T]?: {
      safeParse: (value: unknown) => {
        success: boolean;
        error?: { issues: { message: string }[] };
      };
    };
  },
): NonNullable<AutoSaveOptions<T>["validate"]> {
  return (key, value) => {
    const field = shape[key];
    if (!field) return null;
    const result = field.safeParse(value);
    return result.success
      ? null
      : (result.error?.issues[0]?.message ?? "Ugyldig værdi");
  };
}
