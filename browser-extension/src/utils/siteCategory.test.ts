import { describe, expect, it } from "vitest";
import { categorizeSite, siteFromTab } from "./siteCategory";

describe("categorizeSite", () => {
  it("kender arbejdsdomæner og deres underdomæner", () => {
    expect(categorizeSite("github.com", "")).toMatchObject({
      category: "development",
      isWorkRelated: true,
      confidence: 0.95,
    });
    expect(categorizeSite("app.asana.com", "")).toMatchObject({
      category: "project-management",
      confidence: 0.9,
    });
  });

  it("platformdomæner matcher kun præcist", () => {
    expect(categorizeSite("minapp.vercel.app", "").category).toBe("other");
  });

  it("underholdning er aldrig arbejde, uanset titlen", () => {
    expect(
      categorizeSite("www.youtube.com", "Building a project dashboard"),
    ).toMatchObject({ category: "entertainment", isWorkRelated: false });
  });

  it("titlens nøgleord tæller kun som hele ord", () => {
    expect(categorizeSite("kunde.dk", "Admin").isWorkRelated).toBe(true);
    expect(categorizeSite("kunde.dk", "Projector").isWorkRelated).toBe(false);
  });
});

describe("siteFromTab", () => {
  it("bygger webstedet ud fra fanens url, titel og ikon", () => {
    expect(
      siteFromTab({
        url: "https://github.com/mahope/timetrack",
        title: "TimeTrack",
        favIconUrl: "https://github.com/favicon.ico",
      }),
    ).toEqual({
      url: "https://github.com/mahope/timetrack",
      domain: "github.com",
      title: "TimeTrack",
      favicon: "https://github.com/favicon.ico",
      category: "development",
      isWorkRelated: true,
      confidence: 0.95,
    });
  });

  it("ignorerer browserens egne sider og fanen uden url", () => {
    expect(siteFromTab({ url: "chrome://extensions" })).toBeNull();
    expect(siteFromTab({})).toBeNull();
  });
});
