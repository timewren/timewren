import { describe, expect, it } from "vitest";
import { defaultWorkspaceName } from "./default-workspace-name";

describe("defaultWorkspaceName", () => {
  it("er dansk i den danske app, med dansk genitiv", async () => {
    expect(await defaultWorkspaceName("Freja Testesen", "da")).toBe(
      "Freja Testesens arbejdsområde",
    );
    expect(await defaultWorkspaceName("Hans", "da")).toBe(
      "Hans' arbejdsområde",
    );
  });

  it("er engelsk for en engelsk konto", async () => {
    expect(await defaultWorkspaceName("Freja Testesen", "en")).toBe(
      "Freja Testesen's workspace",
    );
  });
});
