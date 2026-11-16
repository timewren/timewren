import { describe, expect, it } from "vitest";
import { draftFromSearchParams, quickEntryPath } from "./quick-entry-draft";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

describe("quick-entry-draft", () => {
  it("uden action er der intet udkast", () => {
    expect(draftFromSearchParams(new URLSearchParams(""))).toBeNull();
    expect(
      draftFromSearchParams(new URLSearchParams("action=andet")),
    ).toBeNull();
  });

  it("genvejen åbner et tomt udkast", () => {
    expect(
      draftFromSearchParams(new URLSearchParams("action=quick-entry")),
    ).toEqual({
      projectId: null,
      clientId: null,
      hours: null,
      description: "",
    });
  });

  it("kopi fra ny fane kommer frem uændret, også med æøå", () => {
    const path = quickEntryPath({
      projectId: PROJECT,
      clientId: CLIENT,
      hours: 1.5,
      description: "Møde på kontoret & opfølgning",
    });
    const params = new URLSearchParams(path.split("?")[1]);
    expect(draftFromSearchParams(params)).toEqual({
      projectId: PROJECT,
      clientId: CLIENT,
      hours: 1.5,
      description: "Møde på kontoret & opfølgning",
    });
  });

  it("ugyldige id'er og timer ignoreres", () => {
    const params = new URLSearchParams(
      "action=quick-entry&projectId=x&clientId=&hours=-2",
    );
    expect(draftFromSearchParams(params)).toEqual({
      projectId: null,
      clientId: null,
      hours: null,
      description: "",
    });
  });
});
