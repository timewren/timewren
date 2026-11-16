import { describe, expect, it } from "vitest";
import { parseCalendarObject, zonedWallTimeToUtc } from "../ics";

const range = {
  rangeStart: new Date("2026-09-01T00:00:00Z"),
  rangeEnd: new Date("2026-12-31T00:00:00Z"),
};

// Sådan ser et iCloud-objekt ud: CRLF, VTIMEZONE med DST-regler, TZID på tider
const COPENHAGEN_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Copenhagen",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "DTSTART:19810329T020000",
  "TZNAME:CEST",
  "TZOFFSETTO:+0200",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "DTSTART:19961027T030000",
  "TZNAME:CET",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "END:VTIMEZONE",
];

function ics(...lines: string[]) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//macOS 15.0//EN",
    "CALSCALE:GREGORIAN",
    ...lines,
    "END:VCALENDAR",
  ].join("\r\n");
}

describe("parseCalendarObject", () => {
  it("parser en iCloud-hændelse med TZID og VTIMEZONE (sommertid)", () => {
    const events = parseCalendarObject(
      ics(
        ...COPENHAGEN_VTIMEZONE,
        "BEGIN:VEVENT",
        "UID:6F1C2A5E-1111-4B7A-9C3D-ABCDEF012345",
        "DTSTAMP:20260920T080000Z",
        "DTSTART;TZID=Europe/Copenhagen:20260930T100000",
        "DTEND;TZID=Europe/Copenhagen:20260930T113000",
        "SUMMARY:Møde med Jensen & Co",
        "DESCRIPTION:Gennemgang af\\ntilbud",
        "LOCATION:Aarhus",
        "END:VEVENT",
      ),
      range,
    );
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.title).toBe("Møde med Jensen & Co");
    expect(event.description).toBe("Gennemgang af\ntilbud");
    expect(event.location).toBe("Aarhus");
    // 10:00 CEST = 08:00 UTC
    expect(event.startTime.toISOString()).toBe("2026-09-30T08:00:00.000Z");
    expect(event.endTime.toISOString()).toBe("2026-09-30T09:30:00.000Z");
    expect(event.isAllDay).toBe(false);
    expect(event.timezone).toBe("Europe/Copenhagen");
    expect(event.externalId).toBe(
      "caldav:6F1C2A5E-1111-4B7A-9C3D-ABCDEF012345",
    );
    expect(event.isCancelled).toBe(false);
  });

  it("håndterer vintertid via VTIMEZONE", () => {
    const [event] = parseCalendarObject(
      ics(
        ...COPENHAGEN_VTIMEZONE,
        "BEGIN:VEVENT",
        "UID:winter-1",
        "DTSTART;TZID=Europe/Copenhagen:20261110T090000",
        "DTEND;TZID=Europe/Copenhagen:20261110T100000",
        "SUMMARY:Vintermøde",
        "END:VEVENT",
      ),
      range,
    );
    // 09:00 CET = 08:00 UTC
    expect(event.startTime.toISOString()).toBe("2026-11-10T08:00:00.000Z");
  });

  it("falder tilbage til IANA-tidszonen når VTIMEZONE mangler", () => {
    const [event] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:no-vtimezone",
        "DTSTART;TZID=Europe/Copenhagen:20260930T100000",
        "DTEND;TZID=Europe/Copenhagen:20260930T110000",
        "SUMMARY:Uden VTIMEZONE",
        "END:VEVENT",
      ),
      range,
    );
    expect(event.startTime.toISOString()).toBe("2026-09-30T08:00:00.000Z");
    expect(event.endTime.toISOString()).toBe("2026-09-30T09:00:00.000Z");
  });

  it("tolker flydende tider som dansk tid og UTC-tider som UTC", () => {
    const [floating] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:floating",
        "DTSTART:20260930T100000",
        "DTEND:20260930T110000",
        "SUMMARY:Flydende",
        "END:VEVENT",
      ),
      range,
    );
    expect(floating.startTime.toISOString()).toBe("2026-09-30T08:00:00.000Z");

    const [utc] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:utc",
        "DTSTART:20260930T100000Z",
        "DTEND:20260930T110000Z",
        "SUMMARY:UTC",
        "END:VEVENT",
      ),
      range,
    );
    expect(utc.startTime.toISOString()).toBe("2026-09-30T10:00:00.000Z");
  });

  it("parser heldagshændelser som UTC-midnat", () => {
    const [event] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:allday",
        "DTSTART;VALUE=DATE:20261001",
        "DTEND;VALUE=DATE:20261002",
        "SUMMARY:Konference",
        "END:VEVENT",
      ),
      range,
    );
    expect(event.isAllDay).toBe(true);
    expect(event.startTime.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(event.endTime.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("bruger DURATION når DTEND mangler", () => {
    const [event] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:duration",
        "DTSTART:20260930T100000Z",
        "DURATION:PT45M",
        "SUMMARY:Kort møde",
        "END:VEVENT",
      ),
      range,
    );
    expect(event.endTime.toISOString()).toBe("2026-09-30T10:45:00.000Z");
  });

  it("udfolder ugentlige gentagelser med EXDATE og flyttet forekomst", () => {
    const events = parseCalendarObject(
      ics(
        ...COPENHAGEN_VTIMEZONE,
        "BEGIN:VEVENT",
        "UID:weekly-standup",
        "DTSTART;TZID=Europe/Copenhagen:20260907T090000",
        "DTEND;TZID=Europe/Copenhagen:20260907T091500",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;TZID=Europe/Copenhagen:20260914T090000",
        "SUMMARY:Standup",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:weekly-standup",
        "RECURRENCE-ID;TZID=Europe/Copenhagen:20260921T090000",
        "DTSTART;TZID=Europe/Copenhagen:20260921T130000",
        "DTEND;TZID=Europe/Copenhagen:20260921T131500",
        "SUMMARY:Standup (flyttet)",
        "END:VEVENT",
      ),
      range,
    );
    expect(events.map((e) => e.startTime.toISOString())).toEqual([
      "2026-09-07T07:00:00.000Z",
      "2026-09-21T11:00:00.000Z",
      "2026-09-28T07:00:00.000Z",
    ]);
    expect(events[1].title).toBe("Standup (flyttet)");
    // Nøglen følger den oprindelige start, så flytninger opdaterer samme række
    expect(events[1].externalId).toBe(
      "caldav:weekly-standup@2026-09-21T07:00:00.000Z",
    );
    expect(new Set(events.map((e) => e.externalId)).size).toBe(3);
  });

  it("begrænser uendelige gentagelser til intervallet", () => {
    const events = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:daily-forever",
        "DTSTART:20200101T080000Z",
        "DTEND:20200101T083000Z",
        "RRULE:FREQ=DAILY",
        "SUMMARY:Dagligt",
        "END:VEVENT",
      ),
      {
        rangeStart: new Date("2026-09-01T00:00:00Z"),
        rangeEnd: new Date("2026-09-08T00:00:00Z"),
      },
    );
    expect(events).toHaveLength(7);
    expect(events[0].startTime.toISOString()).toBe("2026-09-01T08:00:00.000Z");
  });

  it("kaster når en høj-frekvent serie ikke når frem til vinduet", () => {
    expect(() =>
      parseCalendarObject(
        ics(
          "BEGIN:VEVENT",
          "UID:minutely",
          "DTSTART:20200101T000000Z",
          "DTEND:20200101T000100Z",
          "RRULE:FREQ=MINUTELY",
          "SUMMARY:Hvert minut",
          "END:VEVENT",
        ),
        range,
      ),
    ).toThrow(/overskred/);
  });

  it("udelader hændelser uden for intervallet", () => {
    const events = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:old",
        "DTSTART:20250101T080000Z",
        "DTEND:20250101T090000Z",
        "SUMMARY:Gammel",
        "END:VEVENT",
      ),
      range,
    );
    expect(events).toEqual([]);
  });

  it("markerer STATUS:CANCELLED og finder egen deltagerstatus", () => {
    const [cancelled] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:cancelled",
        "DTSTART:20260930T100000Z",
        "DTEND:20260930T110000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Aflyst",
        "END:VEVENT",
      ),
      range,
    );
    expect(cancelled.isCancelled).toBe(true);

    const [invite] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        "UID:invite",
        "DTSTART:20260930T100000Z",
        "DTEND:20260930T110000Z",
        "SUMMARY:Invitation",
        "ORGANIZER;CN=Kunde:mailto:kunde@example.com",
        "ATTENDEE;CN=Kunde;PARTSTAT=ACCEPTED:mailto:kunde@example.com",
        "ATTENDEE;CN=Marie;PARTSTAT=DECLINED:mailto:Marie@iCloud.com",
        "END:VEVENT",
      ),
      { ...range, selfEmails: ["marie@icloud.com"] },
    );
    expect(invite.responseStatus).toBe("declined");
  });

  it("returnerer tom liste for objekter uden VEVENT (fx VTODO)", () => {
    expect(
      parseCalendarObject(
        ics("BEGIN:VTODO", "UID:todo", "SUMMARY:Opgave", "END:VTODO"),
        range,
      ),
    ).toEqual([]);
  });

  it("kaster ved ugyldig iCalendar", () => {
    expect(() => parseCalendarObject("ikke ical", range)).toThrow();
  });

  it("hasher meget lange UID'er, så external_id holder sig under 255 tegn", () => {
    const uid = "x".repeat(400);
    const [event] = parseCalendarObject(
      ics(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        "DTSTART:20260930T100000Z",
        "DTEND:20260930T110000Z",
        "SUMMARY:Lang UID",
        "END:VEVENT",
      ),
      range,
    );
    expect(event.externalId.length).toBeLessThanOrEqual(255);
    expect(event.externalId.startsWith("caldav:sha256:")).toBe(true);
  });
});

describe("zonedWallTimeToUtc", () => {
  it("omregner dansk vægurstid på begge sider af sommertidsskiftet", () => {
    const wall = { hour: 12, minute: 0, second: 0 };
    expect(
      zonedWallTimeToUtc(
        { year: 2026, month: 3, day: 28, ...wall },
        "Europe/Copenhagen",
      ).toISOString(),
    ).toBe("2026-03-28T11:00:00.000Z");
    expect(
      zonedWallTimeToUtc(
        { year: 2026, month: 3, day: 30, ...wall },
        "Europe/Copenhagen",
      ).toISOString(),
    ).toBe("2026-03-30T10:00:00.000Z");
  });

  it("bruger dansk tid ved ukendt tidszone", () => {
    expect(
      zonedWallTimeToUtc(
        { year: 2026, month: 9, day: 30, hour: 10, minute: 0, second: 0 },
        "Not/AZone",
      ).toISOString(),
    ).toBe("2026-09-30T08:00:00.000Z");
  });
});
