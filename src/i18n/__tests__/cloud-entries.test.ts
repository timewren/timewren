import { describe, expect, it } from "vitest";
import { normalizeMailLocale } from "@/lib/email/locale";
import { resolveOutgoingLocale } from "@/lib/email/request-locale";
import { getT } from "../server";

// Testmiljøet er brandet timetrack (Cloud): kun da, en, de og es må nå frem.
describe("Cloud: nye sprog når ikke igennem serverindgange", () => {
  it("getT falder tilbage til dansk for sv, ikke svensk eller engelsk", async () => {
    const t = (await getT("common", "sv")) as unknown as (k: string) => string;
    const da = (await getT("common", "da")) as unknown as (k: string) => string;
    expect(t("cancel")).toBe(da("cancel"));
  });

  it("udgående mails og afmeldingssider bruger kun Cloud-sprog", async () => {
    expect(await resolveOutgoingLocale("sv")).toBe("da");
    expect(await resolveOutgoingLocale("de")).toBe("de");
    expect(normalizeMailLocale("ja")).toBe("da");
    expect(normalizeMailLocale("es")).toBe("es");
  });
});
