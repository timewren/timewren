import { describe, expect, it } from "vitest";
import { toTimeTaskPayload } from "./time-task-payload";

const client = { id: "kunde-1", name: "Testkunde ApS", color: "#123456" };

const kanbanTask = {
  id: "opgave-1",
  title: "Design forside",
  status: "todo",
  statusId: "lane-1",
  completedAt: null,
  projectId: "projekt-1",
  clientId: "kunde-1",
  description: "Fortrolig beskrivelse",
  estimatedMinutes: 240,
  position: 3,
  priority: "high",
  trackedMinutes: 90,
  project: { id: "projekt-1", name: "Hjemmeside", client },
  client,
  subtasks: [{ id: "under-1", title: "Undertask", status: "todo" }],
};

describe("toTimeTaskPayload (#1116)", () => {
  it("beholder kun de felter, opgavevalget i tidsregistreringen bruger", () => {
    const result = toTimeTaskPayload({ "lane-1": [kanbanTask] });
    expect(result).toEqual({
      "lane-1": [
        {
          id: "opgave-1",
          title: "Design forside",
          status: "todo",
          completedAt: null,
          projectId: "projekt-1",
          clientId: "kunde-1",
          project: {
            id: "projekt-1",
            name: "Hjemmeside",
            client: { id: "kunde-1", name: "Testkunde ApS" },
          },
          client: { id: "kunde-1", name: "Testkunde ApS" },
        },
      ],
    });
  });

  it("tåler opgaver uden projekt og kunde", () => {
    const result = toTimeTaskPayload({
      todo: [{ ...kanbanTask, project: null, client: null }],
    });
    expect(result.todo[0].project).toBeNull();
    expect(result.todo[0].client).toBeNull();
  });
});
