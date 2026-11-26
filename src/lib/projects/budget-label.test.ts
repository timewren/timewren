import { createTranslator } from "next-intl";
import { expect, it } from "vitest";
import da from "@/i18n/messages/da/projects.json";
import en from "@/i18n/messages/en/projects.json";
import { budgetLabel } from "./budget-label";

const t = createTranslator({ locale: "da", messages: da });

it.each([
  ["green", 12.5, "Inden for budgettet: 12,5 af 20 t"],
  ["yellow", 16, "Tæt på budgetgrænsen: 16 af 20 t"],
  ["red", 18, "Ved eller tæt på budgetgrænsen: 18 af 20 t"],
  ["red", 20, "Ved eller tæt på budgetgrænsen: 20 af 20 t"],
  ["red", 20.02, "Over budgettet: 20,02 af 20 t"],
  ["red", 22, "Over budgettet: 22 af 20 t"],
] as const)("labels %s budget usage at %s hours", (status, used, expected) => {
  expect(budgetLabel(t, status, used, 20)).toBe(expected);
});

it("uses the English translation and number format", () => {
  const english = createTranslator({ locale: "en", messages: en });
  expect(budgetLabel(english, "red", 21.5, 20)).toBe(
    "Over budget: 21.5 of 20 h",
  );
});
