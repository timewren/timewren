import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The task router reaches for the module-level `db`, so it has to be mocked
// before the import below or the test would open a real connection.
const mocks = vi.hoisted(() => ({
  findProject: vi.fn(),
  findClient: vi.fn(),
  findTask: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      projects: { findFirst: mocks.findProject },
      clients: { findFirst: mocks.findClient },
      tasks: { findFirst: mocks.findTask },
    },
  },
}));
vi.mock("@/lib/notifications/push", () => ({ pushToUser: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));

import {
  TEST_CLIENT_ID,
  TEST_PROJECT_ID,
  TEST_TASK_ID,
  TEST_USER_ID,
} from "@/test/fixtures";
import { assertTaskReferencesOwned } from "../tasks";

const ORG_ID = "org-0000-0000-0000-000000000001";

/**
 * assertTaskReferencesOwned is the guard that keeps a task from pointing at
 * another tenant's project/client/parent task. tasks.getById joins those
 * relations back out in full, so an unvalidated reference is a read primitive
 * across the org boundary — this is what tasks.bulkUpdate was missing.
 */
describe("assertTaskReferencesOwned", () => {
  beforeEach(() => {
    mocks.findProject.mockReset();
    mocks.findClient.mockReset();
    mocks.findTask.mockReset();
  });

  it("accepterer tomme referencer", async () => {
    await expect(
      assertTaskReferencesOwned(TEST_USER_ID, {}, ORG_ID),
    ).resolves.toBeUndefined();
    expect(mocks.findProject).not.toHaveBeenCalled();
    expect(mocks.findClient).not.toHaveBeenCalled();
  });

  it("accepterer et projekt der tilhører orgen", async () => {
    mocks.findProject.mockResolvedValue({ id: TEST_PROJECT_ID });
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { projectId: TEST_PROJECT_ID },
        ORG_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it("afviser et projekt uden for orgen", async () => {
    mocks.findProject.mockResolvedValue(undefined);
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { projectId: TEST_PROJECT_ID },
        ORG_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepterer en klient der tilhører orgen", async () => {
    mocks.findClient.mockResolvedValue({ id: TEST_CLIENT_ID });
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { clientId: TEST_CLIENT_ID },
        ORG_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it("afviser en klient uden for orgen", async () => {
    mocks.findClient.mockResolvedValue(undefined);
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { clientId: TEST_CLIENT_ID },
        ORG_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("afviser en fremmed klient også for en solo-bruger uden org", async () => {
    mocks.findClient.mockResolvedValue(undefined);
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { clientId: TEST_CLIENT_ID },
        null,
      ),
    ).rejects.toThrow(TRPCError);
  });

  it("afviser en overordnet opgave uden for orgen", async () => {
    mocks.findTask.mockResolvedValue(undefined);
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { parentTaskId: TEST_TASK_ID },
        ORG_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("afviser mere end ét niveau af underopgaver", async () => {
    mocks.findTask.mockResolvedValue({
      id: TEST_TASK_ID,
      parentTaskId: "task-0000-0000-0000-0000-000000000002",
    });
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { parentTaskId: TEST_TASK_ID },
        ORG_ID,
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validerer alle referencer i ét kald (bulkUpdate-stien)", async () => {
    mocks.findProject.mockResolvedValue({ id: TEST_PROJECT_ID });
    mocks.findClient.mockResolvedValue(undefined);
    await expect(
      assertTaskReferencesOwned(
        TEST_USER_ID,
        { projectId: TEST_PROJECT_ID, clientId: TEST_CLIENT_ID },
        ORG_ID,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.findProject).toHaveBeenCalledTimes(1);
    expect(mocks.findClient).toHaveBeenCalledTimes(1);
  });
});
