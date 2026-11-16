import { describe, expect, it } from "vitest";
import { parseCsv, parseEmployeeImport, parseTimeEntryImport } from "../import";

describe("parseCsv", () => {
  it("auto-detekterer semikolon", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("auto-detekterer komma", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("håndterer citater med separator og escaped citater", () => {
    expect(parseCsv('navn;note\n"Jensen; Anne";"Han sagde ""hej"""')).toEqual([
      ["navn", "note"],
      ["Jensen; Anne", 'Han sagde "hej"'],
    ]);
  });

  it("springer tomme linjer over og håndterer CRLF", () => {
    expect(parseCsv("a;b\r\n1;2\r\n\r\n3;4\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
});

describe("parseEmployeeImport", () => {
  const HEADER = "navn;email;afdeling;rolle;timer_pr_uge;leder_email;startdato";

  it("parser gyldige rækker med danske kolonnenavne", () => {
    const result = parseEmployeeImport(
      `${HEADER}\nAnne Hansen;ANNE@example.dk;Almen;medarbejder;37;leder@example.dk;2026-08-01`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        name: "Anne Hansen",
        email: "anne@example.dk",
        department: "Almen",
        role: "member",
        weeklyHours: 37,
        managerEmail: "leder@example.dk",
        startDate: "2026-08-01",
      },
    ]);
  });

  it("kræver navn- og email-kolonner i headeren", () => {
    const result = parseEmployeeImport("foo;bar\n1;2");
    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toContain("navn");
  });

  it("accepterer minimal fil med kun navn og email", () => {
    const result = parseEmployeeImport("navn;email\nBo;bo@x.dk");
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      name: "Bo",
      email: "bo@x.dk",
      role: "member",
      weeklyHours: 37,
      department: null,
      managerEmail: null,
      startDate: null,
    });
  });

  it("afviser ugyldig email, dublet, rolle, timetal og dato med linjenumre", () => {
    const result = parseEmployeeImport(
      [
        HEADER,
        "A;ikke-en-email;;;;;",
        "B;b@x.dk;;chef;;;",
        "C;c@x.dk;;;99;;",
        "D;d@x.dk;;;;;31-13-2026",
        "E;b@x.dk;;;;;",
        "F;f@x.dk;;;;;",
      ].join("\n"),
    );
    expect(result.rows.map((r) => r.email)).toEqual(["f@x.dk"]);
    const messages = result.errors.map((e) => `${e.line}: ${e.message}`);
    expect(messages[0]).toContain("2: Ugyldig email");
    expect(messages[1]).toContain("3: Ukendt rolle");
    expect(messages[2]).toContain("4: Ugyldigt timetal");
    expect(messages[3]).toContain("5: Ugyldig startdato");
    expect(messages[4]).toContain("6: Dublet");
  });

  it("normaliserer dansk dato- og talformat", () => {
    const result = parseEmployeeImport(
      `${HEADER}\nAnne;a@x.dk;;leder;30,5;;01-08-2026`,
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      role: "manager",
      weeklyHours: 30.5,
      startDate: "2026-08-01",
    });
  });
});

describe("parseTimeEntryImport", () => {
  it("parser TimeLog-agtig eksport med danske kolonner", () => {
    const result = parseTimeEntryImport(
      "Medarbejder;Dato;Timer;Projekt;Kommentar\nanne@example.dk;06-01-2026;7,5;Undervisning;Dansk hold A",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        email: "anne@example.dk",
        date: "2026-01-06",
        hours: 7.5,
        projectName: "Undervisning",
        activityName: null,
        description: "Dansk hold A",
      },
    ]);
  });

  it("læser valgfri aktivitet-kolonne (#459)", () => {
    const result = parseTimeEntryImport(
      "email;dato;timer;projekt;aktivitet\nanne@example.dk;2026-01-06;3;Dansk hold A;Forberedelse\nanne@example.dk;2026-01-06;4;Dansk hold A;",
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.activityName)).toEqual([
      "Forberedelse",
      null,
    ]);
  });

  it("kræver email-, dato- og timer-kolonner", () => {
    const result = parseTimeEntryImport("projekt;note\nX;Y");
    expect(result.rows).toEqual([]);
    expect(result.errors[0].message).toContain("dato");
  });

  it("afviser ugyldige rækker med linjenumre men beholder resten", () => {
    const result = parseTimeEntryImport(
      [
        "email;dato;timer",
        "ikke-email;2026-01-05;7",
        "a@x.dk;forkert-dato;7",
        "a@x.dk;2026-01-05;25",
        "a@x.dk;2026-01-05;0",
        "a@x.dk;2026-01-05;7,4",
      ].join("\n"),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].hours).toBe(7.4);
    expect(result.errors).toHaveLength(4);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
  });
});
