import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots", () => {
  const { rules } = robots();
  const list = Array.isArray(rules) ? rules : [rules];

  it("nævner AI-crawlerne eksplicit og tillader de offentlige sider", () => {
    const ai = list.find((r) => Array.isArray(r.userAgent));
    expect(ai?.userAgent).toEqual(
      expect.arrayContaining(["GPTBot", "ClaudeBot", "PerplexityBot"]),
    );
    expect(ai?.allow).toBe("/");
  });

  it("spærrer de private stier for alle regler", () => {
    for (const rule of list) {
      expect(rule.disallow).toEqual(
        expect.arrayContaining(["/api/", "/dashboard/", "/portal/"]),
      );
    }
  });
});
