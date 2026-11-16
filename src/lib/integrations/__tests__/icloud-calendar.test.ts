import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updates: Record<string, unknown>[] = [];
  const inserts: Record<string, unknown>[] = [];
  const db = {
    query: {
      calendarConnections: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      calendarEvents: { findMany: vi.fn() },
    },
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: vi.fn(() =>
            Object.assign(Promise.resolve(undefined), {
              returning: async () => [{ id: "claimed" }],
            }),
          ),
        };
      },
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        inserts.push(values);
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };
  return { db, updates, inserts };
});

vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { CALDAV_AUTH_ERROR_MESSAGE, CalDavError } from "../caldav/client";
import {
  __setCalDavSourceFactoryForTests,
  connectICloud,
  getICloudStatus,
  ICloudConnectError,
  normalizeAppPassword,
  syncICloudCalendars,
} from "../icloud-calendar";

// Falske testværdier bygges ved kørsel (secret-scannere reagerer på literals)
const FAKE_APP_SECRET = ["abcd", "efgh", "ijkl", "mnop"].join("-");
const WRONG_APP_SECRET = ["forkert", "vaerdi"].join("-");

const parentRow = {
  id: "parent-1",
  userId: "user-1",
  organizationId: "org-1",
  provider: "apple",
  providerAccountId: "marie@icloud.com",
  accessToken: "enc",
  parentConnectionId: null,
  syncEnabled: true,
  syncError: null,
  lastSynced: null,
  privacyMode: "off",
  syncFilters: null,
  autoTrackMode: "suggest",
};

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
  mocks.updates.length = 0;
  mocks.inserts.length = 0;
  vi.clearAllMocks();
});

describe("normalizeAppPassword", () => {
  it("fjerner mellemrum fra et indsat app-password", () => {
    const pasted = [" ab-cd", "ef\n"].join(" ");
    expect(normalizeAppPassword(pasted)).toBe("ab-cdef");
  });
});

describe("connectICloud", () => {
  it("afviser forkert password med tydelig fejl og gemmer intet", async () => {
    __setCalDavSourceFactoryForTests(async () => {
      throw new Error(
        "Invalid credentials: PROPFIND https://caldav.icloud.com/ returned 401 Unauthorized",
      );
    });

    const promise = connectICloud({
      userId: "user-1",
      orgId: "org-1",
      appleId: "Marie@iCloud.com",
      appPassword: WRONG_APP_SECRET,
    });
    await expect(promise).rejects.toBeInstanceOf(ICloudConnectError);
    await expect(promise).rejects.toMatchObject({ kind: "auth" });
    await expect(promise).rejects.toThrow(/app-specifikt password/);
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("afviser forbindelsen tydeligt når krypteringsnøglen mangler", async () => {
    delete process.env.ENCRYPTION_KEY;
    const factory = vi.fn();
    __setCalDavSourceFactoryForTests(factory);

    await expect(
      connectICloud({
        userId: "user-1",
        orgId: "org-1",
        appleId: "marie@icloud.com",
        appPassword: FAKE_APP_SECRET,
      }),
    ).rejects.toThrow(/sikker opbevaring af adgangskoder/);
    // Hverken Apple kontaktet eller noget gemt i klartekst
    expect(factory).not.toHaveBeenCalled();
    expect(mocks.db.insert).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("gemmer password krypteret og vælger ingen kalendere", async () => {
    __setCalDavSourceFactoryForTests(async (credentials) => {
      expect(credentials).toEqual({
        username: "marie@icloud.com",
        password: FAKE_APP_SECRET,
      });
      return {
        listCalendars: async () => [
          {
            url: "https://p42-caldav.icloud.com/1/calendars/work/",
            displayName: "Arbejde",
            color: "#ff2968",
            ctag: "1",
          },
        ],
        fetchObjects: async () => [],
      };
    });
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);

    const result = await connectICloud({
      userId: "user-1",
      orgId: "org-1",
      appleId: " Marie@iCloud.com ",
      appPassword: FAKE_APP_SECRET,
    });

    expect(result.calendars).toEqual([
      expect.objectContaining({ displayName: "Arbejde", selected: false }),
    ]);
    expect(mocks.inserts).toHaveLength(1);
    const row = mocks.inserts[0];
    expect(row).toMatchObject({
      userId: "user-1",
      organizationId: "org-1",
      provider: "apple",
      providerAccountId: "marie@icloud.com",
      syncDirection: "inbound",
    });
    expect(row.accessToken).not.toContain(FAKE_APP_SECRET);
    expect(String(row.accessToken).split(":")).toHaveLength(3);
  });
});

describe("syncICloudCalendars", () => {
  it("tilbagekaldt password → stopper synk og beder om ny forbindelse", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(parentRow);
    mocks.db.query.calendarConnections.findMany.mockResolvedValue([
      {
        ...parentRow,
        id: "child-1",
        parentConnectionId: "parent-1",
        accessToken: null,
        calendarId: "https://p42-caldav.icloud.com/1/calendars/work/",
      },
    ]);
    __setCalDavSourceFactoryForTests(async () => {
      throw new Error(
        "Invalid credentials: PROPFIND https://caldav.icloud.com/ returned 401 Unauthorized",
      );
    });

    const result = await syncICloudCalendars("user-1");

    expect(result.success).toBe(false);
    expect(result.needsReconnect).toBe(true);
    expect(result.error).toBe(CALDAV_AUTH_ERROR_MESSAGE);
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        syncEnabled: false,
        syncError: CALDAV_AUTH_ERROR_MESSAGE,
      }),
    );
  });

  it("prøver ikke at logge ind igen, når forbindelsen afventer genforbindelse", async () => {
    const factory = vi.fn();
    __setCalDavSourceFactoryForTests(factory);
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue({
      ...parentRow,
      syncEnabled: false,
      syncError: CALDAV_AUTH_ERROR_MESSAGE,
    });

    const result = await syncICloudCalendars("user-1");

    expect(result).toMatchObject({ success: false, needsReconnect: true });
    expect(factory).not.toHaveBeenCalled();
  });

  it("netværksfejl på en kalender markerer fejlen uden at kræve ny forbindelse", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue(parentRow);
    mocks.db.query.calendarConnections.findMany.mockResolvedValue([
      {
        ...parentRow,
        id: "child-1",
        parentConnectionId: "parent-1",
        calendarId: "https://p42-caldav.icloud.com/1/calendars/work/",
        calendarName: "Arbejde",
        syncToken: null,
      },
    ]);
    __setCalDavSourceFactoryForTests(async () => ({
      listCalendars: async () => [
        {
          url: "https://p42-caldav.icloud.com/1/calendars/work/",
          displayName: "Arbejde",
          color: null,
          ctag: "2",
        },
      ],
      fetchObjects: async () => {
        throw new CalDavError("network", "Kunne ikke få forbindelse");
      },
    }));

    const result = await syncICloudCalendars("user-1");

    expect(result.success).toBe(false);
    expect(result.needsReconnect).toBeUndefined();
    expect(mocks.updates).not.toContainEqual(
      expect.objectContaining({ syncEnabled: false }),
    );
  });
});

describe("getICloudStatus", () => {
  it("viser 'forbind igen'-tilstand og aldrig password", async () => {
    mocks.db.query.calendarConnections.findFirst.mockResolvedValue({
      ...parentRow,
      syncEnabled: false,
      syncError: CALDAV_AUTH_ERROR_MESSAGE,
    });
    mocks.db.query.calendarConnections.findMany.mockResolvedValue([]);

    const status = await getICloudStatus("user-1");

    expect(status).toMatchObject({
      connected: true,
      appleId: "marie@icloud.com",
      needsReconnect: true,
      error: CALDAV_AUTH_ERROR_MESSAGE,
    });
    expect(status).not.toHaveProperty("accessToken");
  });
});
