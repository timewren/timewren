import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import { POST as activate } from "@/app/api/desktop/license/activate/route";
import { POST as trial } from "@/app/api/desktop/license/trial/route";
import { GET as verify } from "@/app/api/desktop/license/verify/route";
import { POST as extensionActivate } from "@/app/api/licenses/activate/route";
import { demoUnavailableResponse } from "../route-guard";

afterEach(() => vi.unstubAllEnvs());

const post = (url: string) =>
  new Request(`https://demo.example${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ licenseKey: "X", deviceId: "d" }),
  });

describe("licens-endpoints i demo-tilstand", () => {
  it("svarer 403 uden at røre databasen", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    for (const res of [
      await activate(post("/api/desktop/license/activate")),
      await trial(post("/api/desktop/license/trial")),
      await verify(
        new Request(
          "https://demo.example/api/desktop/license/verify?key=X",
        ) as never,
      ),
      await extensionActivate(post("/api/licenses/activate")),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("demo_unavailable");
    }
  });

  it("guarden er null uden DEMO_MODE", () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(demoUnavailableResponse()).toBeNull();
  });
});
