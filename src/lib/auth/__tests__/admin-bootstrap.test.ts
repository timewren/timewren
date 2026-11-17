import { describe, expect, it, vi } from "vitest";
import { adminEmailsFromEnv, bootstrapAdmin } from "../admin-bootstrap";
import {
  isEmailVerificationRequired,
  resetEmailVerificationWarningForTests,
} from "../email-verification";

type Row = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: string | null;
} | null;

/** Falsk db: findFirst giver `row`; update(...).set(...).where(...) logges. */
function fakeDb(row: Row, promotedRows: { id: string }[] = []) {
  const set = vi.fn();
  const where = vi.fn(() => {
    const result = Promise.resolve(undefined) as Promise<undefined> & {
      returning: () => Promise<{ id: string }[]>;
    };
    result.returning = () => Promise.resolve(promotedRows);
    return result;
  });
  set.mockReturnValue({ where });
  const db = {
    query: { users: { findFirst: vi.fn().mockResolvedValue(row) } },
    update: vi.fn(() => ({ set })),
  };
  return { db: db as never, set, where, update: db.update };
}

const user = (over: Partial<NonNullable<Row>> = {}): Row => ({
  id: "u1",
  email: "Admin@Example.com",
  emailVerified: true,
  role: "user",
  ...over,
});

describe("adminEmailsFromEnv", () => {
  it("læser kommasepareret liste, små bogstaver", () => {
    expect(
      adminEmailsFromEnv({ ADMIN_EMAIL: " A@x.dk, b@x.dk ,," } as never),
    ).toEqual(["a@x.dk", "b@x.dk"]);
    expect(adminEmailsFromEnv({} as never)).toEqual([]);
  });
});

describe("bootstrapAdmin med ADMIN_EMAIL", () => {
  const env = { ADMIN_EMAIL: "admin@example.com", RESEND_API_KEY: "re_x" };

  it("gør en bekræftet bruger med matchende mail til admin (case-ufølsomt)", async () => {
    const f = fakeDb(user());
    expect(await bootstrapAdmin(f.db, "u1", env as never)).toBe(true);
    expect(f.set).toHaveBeenCalledWith({ role: "admin" });
  });

  it("rører ikke en anden bruger", async () => {
    const f = fakeDb(user({ email: "andre@example.com" }));
    expect(await bootstrapAdmin(f.db, "u1", env as never)).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  });

  it("promoverer ikke en ubekræftet adresse når verifikation er påkrævet", async () => {
    const f = fakeDb(user({ emailVerified: false }));
    expect(await bootstrapAdmin(f.db, "u1", env as never)).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  });

  it("promoverer en ubekræftet adresse når verifikation er slået fra", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeDb(user({ emailVerified: false }));
    const off = {
      ADMIN_EMAIL: "admin@example.com",
      REQUIRE_EMAIL_VERIFICATION: "false",
    };
    expect(await bootstrapAdmin(f.db, "u1", off as never)).toBe(true);
  });

  it("gør intet hvis brugeren allerede er admin", async () => {
    const f = fakeDb(user({ role: "admin" }));
    expect(await bootstrapAdmin(f.db, "u1", env as never)).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  });
});

describe("bootstrapAdmin uden ADMIN_EMAIL (første bruger)", () => {
  it("returnerer om det atomiske UPDATE ramte brugeren", async () => {
    const yes = fakeDb(user(), [{ id: "u1" }]);
    expect(await bootstrapAdmin(yes.db, "u1", {} as never)).toBe(true);
    const no = fakeDb(user(), []);
    expect(await bootstrapAdmin(no.db, "u1", {} as never)).toBe(false);
  });

  it("ukendt bruger giver false", async () => {
    const f = fakeDb(null);
    expect(await bootstrapAdmin(f.db, "ukendt", {} as never)).toBe(false);
  });
});

describe("isEmailVerificationRequired", () => {
  it("er påkrævet som standard og med Resend/SMTP (prod ændres ikke)", () => {
    expect(isEmailVerificationRequired({} as never)).toBe(true);
    expect(
      isEmailVerificationRequired({
        RESEND_API_KEY: "re_x",
        REQUIRE_EMAIL_VERIFICATION: "false",
      } as never),
    ).toBe(true);
    expect(
      isEmailVerificationRequired({
        SMTP_HOST: "smtp.x",
        REQUIRE_EMAIL_VERIFICATION: "false",
      } as never),
    ).toBe(true);
  });

  it("kan slås fra uden mail-transport, med advarsel", () => {
    resetEmailVerificationWarningForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      isEmailVerificationRequired({
        REQUIRE_EMAIL_VERIFICATION: "false",
      } as never),
    ).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ADVARSEL");
  });

  it("andre værdier end false/0 holder verifikationen tændt", () => {
    expect(
      isEmailVerificationRequired({
        REQUIRE_EMAIL_VERIFICATION: "true",
      } as never),
    ).toBe(true);
  });
});

describe("bootstrapAdmin i demo-tilstand (DEMO_MODE=1)", () => {
  it("gør aldrig en demobruger til admin, heller ikke den første bruger", async () => {
    const f = fakeDb(user({ email: "demo-abc@demo.invalid" }), [{ id: "u1" }]);
    expect(await bootstrapAdmin(f.db, "u1", { DEMO_MODE: "1" } as never)).toBe(
      false,
    );
    expect(f.update).not.toHaveBeenCalled();
  });

  it("ADMIN_EMAIL virker stadig for en rigtig bruger på demo-instansen", async () => {
    const f = fakeDb(user());
    const env = { DEMO_MODE: "1", ADMIN_EMAIL: "admin@example.com" };
    expect(await bootstrapAdmin(f.db, "u1", env as never)).toBe(true);
  });
});
