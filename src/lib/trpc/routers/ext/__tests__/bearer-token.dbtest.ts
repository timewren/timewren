/**
 * Tokenet i `Authorization: Bearer <token>` i stedet for i input, så det
 * ikke står i `?input=` på en GET (og i proxy-logs). Input-tokenet virker
 * stadig, så udvidelsen ikke går i stykker.
 */

import { describe, expect, it } from "vitest";
import { GET as trpcGet } from "@/app/api/trpc/[trpc]/route";
import { deviceCaller, seedAccount } from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code?: string; message: string };
  }
  throw new Error("forventede en fejl");
}

/** Token-API'ets queries uden token i input (kun headeren). */
// biome-ignore lint/suspicious/noExplicitAny: input uden token er kontrakten her
type Loose = any;

describe.skipIf(!enabled)("token i Authorization-headeren", () => {
  it("ext-queries og de flade queries virker med headeren alene", async () => {
    const acc = await seedAccount();
    const api = deviceCaller("desktop/0.2.24", undefined, acc.token)
      .extension as Loose;
    await deviceCaller().extension.clients.create({
      token: acc.token,
      data: { name: "Headerkunde" },
    });

    const ent = await api.entitlements.get({});
    expect(ent).toBeTruthy();
    const list = await api.clients.list({});
    expect(list.map((c: { name: string }) => c.name)).toContain("Headerkunde");
    // Uden input overhovedet (GET uden ?input=).
    await expect(api.invoices.uninvoicedSummary()).resolves.toBeDefined();

    const valid = await api.validateToken({});
    expect(valid.valid).toBe(true);
    const orgs = await api.listOrganizations({});
    expect(orgs.some((o: { id: string }) => o.id === acc.orgId)).toBe(true);
    await expect(api.getTimerStateWithVersion({})).resolves.toBeDefined();
    await expect(api.getPrepaidPackages({})).resolves.toBeDefined();
  });

  it("input-tokenet virker stadig, og et forkert header-token afvises", async () => {
    const acc = await seedAccount();
    const plain = deviceCaller().extension;
    expect(await plain.entitlements.get({ token: acc.token })).toBeTruthy();
    expect(await plain.clients.list({ token: acc.token })).toEqual([]);

    const wrong = deviceCaller("desktop/0.2.24", "10.9.0.1", "forkert-token")
      .extension as Loose;
    const err = await errorOf(wrong.clients.list({}));
    expect(err.code).toBe("UNAUTHORIZED");

    // Hverken input eller header: afvist.
    const none = deviceCaller().extension as Loose;
    const err2 = await errorOf(none.clients.list({}));
    expect(err2.code).toMatch(/UNAUTHORIZED|BAD_REQUEST/);
  });

  it("over HTTP: GET uden token i URL'en", async () => {
    const acc = await seedAccount();
    const url = "http://localhost/api/trpc/extension.clients.list";
    const res = await trpcGet(
      new Request(url, {
        headers: {
          authorization: `Bearer ${acc.token}`,
          "x-timetrack-client": "desktop/0.2.24",
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.data.json).toEqual([]);
    expect(url).not.toContain(acc.token);
  });
});
