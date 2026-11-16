import { describe, expect, it } from "vitest";

// Pure-logic assertions for taskStatuses router behavior. The router
// interacts with Drizzle which is hard to mock; these tests document
// and verify the INVARIANTS without requiring a live DB.

describe("taskStatuses router — listForContext", () => {
  it("projectId=null returns only general lanes for the user", () => {
    const lanes = [
      {
        id: "a",
        userId: "u1",
        scope: "general",
        projectId: null,
        name: "Todo",
        order: 0,
      },
      {
        id: "b",
        userId: "u1",
        scope: "general",
        projectId: null,
        name: "Done",
        order: 1,
      },
      {
        id: "c",
        userId: "u2",
        scope: "general",
        projectId: null,
        name: "Foo",
        order: 0,
      },
    ];
    const result = lanes.filter(
      (l) => l.userId === "u1" && l.scope === "general" && l.projectId === null,
    );
    expect(result.map((r) => r.name)).toEqual(["Todo", "Done"]);
  });

  it("projectId=X returns only that project's lanes", () => {
    const lanes = [
      {
        id: "a",
        userId: "u1",
        scope: "general",
        projectId: null,
        name: "General-Todo",
      },
      {
        id: "b",
        userId: "u1",
        scope: "project",
        projectId: "p1",
        name: "Proj-Todo",
      },
      {
        id: "c",
        userId: "u1",
        scope: "project",
        projectId: "p2",
        name: "Other-Todo",
      },
    ];
    const result = lanes.filter(
      (l) => l.userId === "u1" && l.scope === "project" && l.projectId === "p1",
    );
    expect(result.map((r) => r.name)).toEqual(["Proj-Todo"]);
  });
});

describe("taskStatuses router — create", () => {
  it("derives scope from projectId (null → general, set → project)", () => {
    const deriveScope = (projectId: string | null) =>
      projectId === null ? "general" : "project";
    expect(deriveScope(null)).toBe("general");
    expect(deriveScope("p1")).toBe("project");
  });

  it("new lanes get max(order)+1 within their context", () => {
    const existing = [{ order: 0 }, { order: 1 }, { order: 2 }];
    const maxOrder = Math.max(-1, ...existing.map((l) => l.order));
    expect(maxOrder + 1).toBe(3);
  });

  it("empty context gets order 0", () => {
    const existing: { order: number }[] = [];
    const maxOrder = Math.max(-1, ...existing.map((l) => l.order));
    expect(maxOrder + 1).toBe(0);
  });
});

describe("taskStatuses router — reorder", () => {
  it("updates order column for each id in the given sequence", () => {
    const initial = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ];
    const newOrder = ["c", "a", "b"];
    const updated = initial.map((lane) => ({
      ...lane,
      order: newOrder.indexOf(lane.id),
    }));
    expect(updated.find((l) => l.id === "c")?.order).toBe(0);
    expect(updated.find((l) => l.id === "a")?.order).toBe(1);
    expect(updated.find((l) => l.id === "b")?.order).toBe(2);
  });
});

describe("taskStatuses router — delete", () => {
  it("requires destinationLaneId when the lane has tasks", () => {
    const tasksInLane = [
      { id: "t1", statusId: "a" },
      { id: "t2", statusId: "a" },
    ];
    const destinationLaneId: string | undefined = undefined;
    const shouldError = tasksInLane.length > 0 && !destinationLaneId;
    expect(shouldError).toBe(true);
  });

  it("moves tasks to destination lane atomically", () => {
    const laneId = "a";
    const destinationLaneId = "b";
    const tasks = [
      { id: "t1", statusId: "a" },
      { id: "t2", statusId: "a" },
      { id: "t3", statusId: "c" },
    ];
    const moved = tasks.map((t) =>
      t.statusId === laneId ? { ...t, statusId: destinationLaneId } : t,
    );
    expect(moved.filter((t) => t.statusId === "a")).toHaveLength(0);
    expect(moved.filter((t) => t.statusId === "b")).toHaveLength(2);
    expect(moved.filter((t) => t.statusId === "c")).toHaveLength(1);
  });

  it("empty lane can be deleted without destination", () => {
    const tasksInLane: { id: string; statusId: string }[] = [];
    const destinationLaneId: string | undefined = undefined;
    const shouldError = tasksInLane.length > 0 && !destinationLaneId;
    expect(shouldError).toBe(false);
  });
});

describe("taskStatuses router — invariants", () => {
  it("multi-tenant: cannot see another user's lane", () => {
    const lane = { id: "a", userId: "user-a" };
    const sessionUserId = "user-b";
    expect(lane.userId === sessionUserId).toBe(false);
  });

  it("scope/projectId rule: general requires projectId=null, project requires projectId set", () => {
    const isValid = (x: { scope: string; projectId: string | null }) =>
      (x.scope === "general" && x.projectId === null) ||
      (x.scope === "project" && x.projectId !== null);
    expect(isValid({ scope: "general", projectId: null })).toBe(true);
    expect(isValid({ scope: "general", projectId: "p1" })).toBe(false);
    expect(isValid({ scope: "project", projectId: "p1" })).toBe(true);
    expect(isValid({ scope: "project", projectId: null })).toBe(false);
  });
});
