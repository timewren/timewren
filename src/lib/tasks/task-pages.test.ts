import { expect, it, vi } from "vitest";
import { collectTaskPages, type TaskCursor } from "./task-pages";

it("keeps server order and ignores repeated rows across cursor pages", async () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  const nextCursor = {
    id: "b",
    position: 2,
    priority: null,
    deadline: null,
    createdAt: null,
  };
  const fetchPage = vi.fn(async (cursor: TaskCursor | null) =>
    cursor === null
      ? { rows: [a, b], nextCursor }
      : { rows: [b, c], nextCursor: null },
  );

  await expect(collectTaskPages(fetchPage)).resolves.toEqual([a, b, c]);
  expect(fetchPage.mock.calls).toEqual([[null], [nextCursor]]);
});
