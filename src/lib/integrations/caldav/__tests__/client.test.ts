import { describe, expect, it } from "vitest";
import {
  CALDAV_AUTH_ERROR_MESSAGE,
  CalDavError,
  classifyCalDavError,
  createCalDavSource,
  isAllowedICloudUrl,
  normalizeCalendarColor,
  parseCalendarQueryResponses,
  toCalDavTimestamp,
} from "../client";

describe("classifyCalDavError", () => {
  it("genkender forkert password (tsdav's 401-fejl) som auth", () => {
    const error = classifyCalDavError(
      new Error(
        "Invalid credentials: PROPFIND https://caldav.icloud.com/ returned 401 Unauthorized",
      ),
    );
    expect(error.kind).toBe("auth");
    expect(error.message).toBe(CALDAV_AUTH_ERROR_MESSAGE);
    expect(error.message).toContain("appleid.apple.com");
  });

  it("behandler 403 på en enkelt kalender som kalenderfejl, ikke login", () => {
    expect(
      classifyCalDavError(new Error("CalDAV REPORT returned 403 Forbidden"))
        .kind,
    ).not.toBe("auth");
  });

  it("genkender netværksfejl og 5xx som midlertidige", () => {
    expect(classifyCalDavError(new Error("fetch failed")).kind).toBe("network");
    expect(
      classifyCalDavError(new Error("CalDAV REPORT returned 503 Unavailable"))
        .kind,
    ).toBe("network");
  });

  it("lader ukendte fejl være ukendte og bevarer eksisterende CalDavError", () => {
    expect(classifyCalDavError(new Error("mærkeligt")).kind).toBe("unknown");
    const original = new CalDavError("auth", "x");
    expect(classifyCalDavError(original)).toBe(original);
  });
});

describe("isAllowedICloudUrl", () => {
  it("tillader kun https på iCloud-domæner", () => {
    expect(
      isAllowedICloudUrl(
        "https://p42-caldav.icloud.com:443/123456/calendars/ABC/",
      ),
    ).toBe(true);
    expect(isAllowedICloudUrl("https://caldav.icloud.com/")).toBe(true);
    expect(isAllowedICloudUrl("http://p42-caldav.icloud.com/")).toBe(false);
    expect(isAllowedICloudUrl("https://icloud.com.evil.dk/")).toBe(false);
    expect(isAllowedICloudUrl("https://169.254.169.254/")).toBe(false);
    expect(isAllowedICloudUrl("ikke en url")).toBe(false);
  });
});

describe("normalizeCalendarColor", () => {
  it("skærer Apples #RRGGBBAA ned til #rrggbb", () => {
    expect(normalizeCalendarColor("#FF2968FF")).toBe("#ff2968");
    expect(normalizeCalendarColor({ _text: "#1BADF8" })).toBe("#1badf8");
    expect(normalizeCalendarColor("rød")).toBeNull();
    expect(normalizeCalendarColor(undefined)).toBeNull();
  });
});

describe("toCalDavTimestamp", () => {
  it("formaterer som CalDAV time-range", () => {
    expect(toCalDavTimestamp(new Date("2026-09-30T12:34:56.789Z"))).toBe(
      "20260930T123456Z",
    );
  });
});

describe("parseCalendarQueryResponses", () => {
  const calendarUrl = "https://p42-caldav.icloud.com/123/calendars/work/";

  it("returnerer objekter med etag og data", () => {
    const objects = parseCalendarQueryResponses(
      [
        {
          href: "/123/calendars/work/a.ics",
          ok: true,
          status: 200,
          props: { getetag: '"abc"', calendarData: "BEGIN:VCALENDAR..." },
        },
        {
          href: "/123/calendars/work/b.ics",
          ok: true,
          status: 200,
          props: {
            getetag: 12345,
            calendarData: { _cdata: "BEGIN:VCALENDAR" },
          },
        },
        // Et enkelt objekt der ikke kunne læses, springes over
        {
          href: "/123/calendars/work/c.ics",
          ok: false,
          status: 404,
          props: {},
        },
      ],
      calendarUrl,
    );
    expect(objects).toEqual([
      {
        url: "https://p42-caldav.icloud.com/123/calendars/work/a.ics",
        etag: '"abc"',
        data: "BEGIN:VCALENDAR...",
      },
      {
        url: "https://p42-caldav.icloud.com/123/calendars/work/b.ics",
        etag: "12345",
        data: "BEGIN:VCALENDAR",
      },
    ]);
  });

  it("kaster auth-fejl når hele requesten afvises — aldrig en tom kalender", () => {
    expect(() =>
      parseCalendarQueryResponses(
        [
          {
            href: calendarUrl,
            ok: false,
            status: 401,
            statusText: "Unauthorized",
          },
        ],
        calendarUrl,
      ),
    ).toThrowError(CalDavError);
    try {
      parseCalendarQueryResponses(
        [{ href: calendarUrl, ok: false, status: 401 }],
        calendarUrl,
      );
    } catch (error) {
      expect((error as CalDavError).kind).toBe("auth");
    }
  });

  it("accepterer en tom kalender (207 uden svar)", () => {
    expect(
      parseCalendarQueryResponses([{ ok: true, status: 207 }], calendarUrl),
    ).toEqual([]);
  });
});

describe("createCalDavSource", () => {
  it("kaster CalDavError(auth) når iCloud svarer 401 på login", async () => {
    const requests: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response("Unauthorized", {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-type": "text/plain" },
      });
    }) as typeof fetch;

    await expect(
      createCalDavSource(
        { username: "marie@icloud.com", password: ["for", "kert"].join("") },
        { fetch: fakeFetch },
      ),
    ).rejects.toMatchObject({ name: "CalDavError", kind: "auth" });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((url) => url.includes("icloud.com"))).toBe(true);
  });
});
