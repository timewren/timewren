import { describe, expect, it } from "vitest";
import { buildTimeEntrySchema } from "../time-entry-form-schema";

const validEntry = {
  description: "Undervisning",
  hours: 2,
  date: "2026-08-27",
};

describe("buildTimeEntrySchema (#426)", () => {
  describe("clients off + projects on (enterprise-org)", () => {
    const schema = buildTimeEntrySchema({
      showClients: false,
      showProjects: true,
    });

    it("accepts projectId alone without clientId", () => {
      const result = schema.safeParse({
        ...validEntry,
        projectId: "proj-1",
        clientId: "",
      });
      expect(result.success).toBe(true);
    });

    it("rejects an entry without projectId and points at projectId", () => {
      const result = schema.safeParse({
        ...validEntry,
        projectId: "",
        clientId: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(["projectId"]);
        expect(result.error.issues[0].message).toBe("Vælg et projekt");
      }
    });

    it("does not accept clientId as a substitute for projectId", () => {
      const result = schema.safeParse({
        ...validEntry,
        projectId: "",
        clientId: "client-1",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("both modules on (freelancer-org)", () => {
    const schema = buildTimeEntrySchema({
      showClients: true,
      showProjects: true,
    });

    it("accepts internal time without project and client, like the timer", () => {
      expect(
        schema.safeParse({ ...validEntry, projectId: "", clientId: "" })
          .success,
      ).toBe(true);
    });

    it("accepts clientId alone", () => {
      expect(
        schema.safeParse({ ...validEntry, projectId: "", clientId: "c-1" })
          .success,
      ).toBe(true);
    });

    it("accepts projectId alone", () => {
      expect(
        schema.safeParse({ ...validEntry, projectId: "p-1", clientId: "" })
          .success,
      ).toBe(true);
    });
  });

  describe("both modules off", () => {
    const schema = buildTimeEntrySchema({
      showClients: false,
      showProjects: false,
    });

    it("has no project/client requirement", () => {
      expect(
        schema.safeParse({ ...validEntry, projectId: "", clientId: "" })
          .success,
      ).toBe(true);
    });
  });

  it("still validates the base fields regardless of modules", () => {
    const schema = buildTimeEntrySchema({
      showClients: false,
      showProjects: true,
    });
    const result = schema.safeParse({
      ...validEntry,
      description: "",
      projectId: "p-1",
    });
    expect(result.success).toBe(false);
  });
});

describe("tidsinterval", () => {
  const schema = buildTimeEntrySchema({
    showClients: false,
    showProjects: false,
  });

  it("afviser ens start og slut i stedet for at gemme 0 timer", () => {
    const result = schema.safeParse({
      ...validEntry,
      startTime: "09:00",
      endTime: "09:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Sluttid skal være efter starttid",
      );
      expect(result.error.issues[0]?.path).toEqual(["endTime"]);
    }
  });

  it("slut før start er en nattevagt (næste dag) og er gyldig", () => {
    expect(
      schema.safeParse({ ...validEntry, startTime: "23:00", endTime: "01:00" })
        .success,
    ).toBe(true);
  });

  it("almindeligt interval er gyldigt", () => {
    expect(
      schema.safeParse({ ...validEntry, startTime: "09:00", endTime: "11:00" })
        .success,
    ).toBe(true);
  });
});
