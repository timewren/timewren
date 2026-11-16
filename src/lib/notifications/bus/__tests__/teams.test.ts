import { describe, expect, it, vi } from "vitest";
import {
  buildTeamsCard,
  maskWebhookUrl,
  postTeamsCard,
  TeamsWebhookError,
  validateTeamsWebhookUrl,
} from "../teams";

describe("validateTeamsWebhookUrl", () => {
  it("accepterer O365-connector og Power Automate-URL'er", () => {
    for (const url of [
      "https://contoso.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456",
      "https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x",
      "https://abc.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x/triggers/manual/paths/invoke",
    ]) {
      expect(validateTeamsWebhookUrl(url)).toEqual({ ok: true, url });
    }
  });

  it("afviser http, ukendte hosts og ugyldige URL'er", () => {
    expect(
      validateTeamsWebhookUrl("http://contoso.webhook.office.com/x").ok,
    ).toBe(false);
    expect(validateTeamsWebhookUrl("https://evil.example.com/hook").ok).toBe(
      false,
    );
    expect(validateTeamsWebhookUrl("ikke en url").ok).toBe(false);
    expect(
      validateTeamsWebhookUrl("https://webhook.office.com.evil.com/x").ok,
    ).toBe(false);
  });

  it("trimmer whitespace", () => {
    const r = validateTeamsWebhookUrl("  https://a.webhook.office.com/x  ");
    expect(r).toEqual({ ok: true, url: "https://a.webhook.office.com/x" });
  });
});

describe("maskWebhookUrl", () => {
  it("viser kun host og de sidste tegn", () => {
    const masked = maskWebhookUrl(
      "https://contoso.webhook.office.com/webhookb2/secret-token-abcdef",
    );
    expect(masked).toBe("https://contoso.webhook.office.com/…abcdef");
    expect(masked).not.toContain("secret-token");
  });

  it("returnerer null uden URL", () => {
    expect(maskWebhookUrl(null)).toBeNull();
  });
});

describe("buildTeamsCard", () => {
  it("bygger et Adaptive Card med titel, tekst, facts og link", () => {
    const card = buildTeamsCard(
      {
        title: "Timeseddel til godkendelse",
        body: "Mette har indsendt uge 35",
        url: "/dashboard/enterprise/team",
        facts: [{ name: "Uge", value: "uge 35" }],
      },
      { orgName: "Eksempel Skole", appUrl: "https://app.timetrack.dk" },
    );
    expect(card.type).toBe("message");
    const content = card.attachments[0].content as {
      type: string;
      body: Array<Record<string, unknown>>;
      actions: Array<{ url: string }>;
    };
    expect(content.type).toBe("AdaptiveCard");
    expect(content.body[0]).toMatchObject({
      text: "Timeseddel til godkendelse",
    });
    expect(content.body[1]).toMatchObject({
      text: "Mette har indsendt uge 35",
    });
    expect(content.body[2]).toMatchObject({
      type: "FactSet",
      facts: [{ title: "Uge", value: "uge 35" }],
    });
    expect(content.body[3]).toMatchObject({
      text: "TimeTrack · Eksempel Skole",
    });
    expect(content.actions[0].url).toBe(
      "https://app.timetrack.dk/dashboard/enterprise/team",
    );
  });
});

function mockFetch(impl: (...args: unknown[]) => Promise<Response>) {
  return vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("postTeamsCard", () => {
  const card = buildTeamsCard(
    { title: "t", body: "b", url: "/x" },
    { appUrl: "https://app" },
  );

  it("poster JSON og accepterer 2xx", async () => {
    const fetchImpl = mockFetch(async () => new Response("1", { status: 200 }));
    await postTeamsCard("https://a.webhook.office.com/x", card, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBeTypeOf("string");
    expect(url).toBe("https://a.webhook.office.com/x");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string).type).toBe("message");
  });

  it("behandler timeout som permanent (ingen retry) og netværksfejl som transient", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    const eTimeout = await postTeamsCard(
      "https://a.webhook.office.com/x",
      card,
      mockFetch(async () => {
        throw timeout;
      }),
    ).catch((e: unknown) => e);
    expect(eTimeout).toBeInstanceOf(TeamsWebhookError);
    expect((eTimeout as TeamsWebhookError).transient).toBe(false);
  });

  it("markerer 5xx og netværksfejl som transiente, 4xx som permanente", async () => {
    const e500 = await postTeamsCard(
      "https://a.webhook.office.com/x",
      card,
      mockFetch(async () => new Response("oops", { status: 503 })),
    ).catch((e: unknown) => e);
    expect(e500).toBeInstanceOf(TeamsWebhookError);
    expect((e500 as TeamsWebhookError).transient).toBe(true);

    const e400 = await postTeamsCard(
      "https://a.webhook.office.com/x",
      card,
      mockFetch(async () => new Response("bad", { status: 400 })),
    ).catch((e: unknown) => e);
    expect((e400 as TeamsWebhookError).transient).toBe(false);

    const eNet = await postTeamsCard(
      "https://a.webhook.office.com/x",
      card,
      mockFetch(async () => {
        throw new Error("fetch failed");
      }),
    ).catch((e: unknown) => e);
    expect((eNet as TeamsWebhookError).transient).toBe(true);
  });
});
