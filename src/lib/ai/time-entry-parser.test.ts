import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { parseTimeEntryWithAI } from "./time-entry-parser";

// openai.ts åbner en DB-forbindelse ved import; klienten injiceres i testene
vi.mock("./openai", () => ({ getOpenAIForUser: vi.fn() }));

function fakeClient(content: string | null) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return {
    create,
    getClient: async () => ({ client, model: "odin-2" }),
  };
}

const clients = [
  { id: "uuid-karen", name: "Karen Jensen" },
  { id: "uuid-hansen", name: "Hansen Byg ApS" },
];
const projects = [
  { id: "uuid-web", name: "Ny hjemmeside", clientId: "uuid-hansen" },
];

describe("parseTimeEntryWithAI", () => {
  it("sender kun tekst, dato og navne under korte nøgler — ingen id'er", async () => {
    const { create, getClient } = fakeClient(
      JSON.stringify({ hours: 0.25, client: "k1", description: "Opkald" }),
    );
    await parseTimeEntryWithAI({
      userId: "u1",
      text: "ringede til karen",
      today: "2026-10-01",
      clients,
      projects,
      getClient,
    });
    const body = create.mock.calls[0][0];
    const prompt = JSON.stringify(body.messages);
    expect(prompt).toContain("k1: Karen Jensen");
    expect(prompt).toContain("p1: Ny hjemmeside (klient k2)");
    expect(prompt).toContain("ringede til karen");
    expect(prompt).not.toContain("uuid-");
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("oversætter nøgler til id'er", async () => {
    const { getClient } = fakeClient(
      JSON.stringify({
        hours: 1.5,
        date: "2026-09-30",
        client: "k2",
        project: "p1",
        billable: false,
        description: "Møde",
      }),
    );
    const { suggestion, model } = await parseTimeEntryWithAI({
      userId: "u1",
      text: "x",
      today: "2026-10-01",
      clients,
      projects,
      getClient,
    });
    expect(model).toBe("odin-2");
    expect(suggestion).toEqual({
      hours: 1.5,
      date: "2026-09-30",
      startTime: null,
      endTime: null,
      clientId: "uuid-hansen",
      projectId: "uuid-web",
      isBillable: false,
      description: "Møde",
    });
  });

  it("ukendte nøgler og ugyldige felter bliver null", async () => {
    const { getClient } = fakeClient(
      JSON.stringify({
        hours: -2,
        date: "2026-13-45",
        startTime: "25:00",
        client: "k99",
        project: "uuid-web",
        description: "Noget",
      }),
    );
    const { suggestion } = await parseTimeEntryWithAI({
      userId: "u1",
      text: "x",
      today: "2026-10-01",
      clients,
      projects,
      getClient,
    });
    expect(suggestion.hours).toBeNull();
    expect(suggestion.date).toBeNull();
    expect(suggestion.startTime).toBeNull();
    expect(suggestion.clientId).toBeNull();
    expect(suggestion.projectId).toBeNull();
  });

  it("projektets klient vinder over en klient, der ikke hører til", async () => {
    const { getClient } = fakeClient(
      JSON.stringify({ hours: 1, client: "k1", project: "p1" }),
    );
    const { suggestion } = await parseTimeEntryWithAI({
      userId: "u1",
      text: "x",
      today: "2026-10-01",
      clients,
      projects,
      getClient,
    });
    expect(suggestion.clientId).toBe("uuid-hansen");
  });

  it("kaster ved ugyldig JSON", async () => {
    const { getClient } = fakeClient("ikke json");
    await expect(
      parseTimeEntryWithAI({
        userId: "u1",
        text: "x",
        today: "2026-10-01",
        clients,
        projects,
        getClient,
      }),
    ).rejects.toThrow("gyldig JSON");
  });
});
