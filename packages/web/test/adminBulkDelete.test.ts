import { expect, it } from "vitest";
import { Message, update } from "../src/AdminApp.ts";

const rooms = ["First", "Second"].map((title, i) => ({
  id: `room-${i}`,
  title,
  phase: "write" as const,
  template: "mad-sad-glad" as const,
  participants: 1,
  notes: 1,
  actions: 0,
  createdAt: null,
  updatedAt: null,
}));

const base = () => ({
  rooms,
  pending: [],
  bulkTotal: 0,
  loading: false,
  deleting: false,
  search: "First",
  filter: "closed",
  selected: "__all__",
  confirmation: "DELETE ALL",
  error: "",
  notice: "",
});

it("requires explicit confirmation and an idle loaded list", () => {
  for (const change of [
    { confirmation: "" },
    { selected: "" },
    { loading: true },
    { deleting: true },
    { rooms: [] },
  ])
    expect(
      update({ ...base(), ...change }, Message.DeleteAll()).commands,
    ).toBeUndefined();
});

it("deletes the entire confirmed snapshot sequentially, regardless of filters", () => {
  const first = update(base(), Message.DeleteAll());
  expect(first.model.pending).toHaveLength(2);
  expect(first.commands?.[0]?.args).toEqual({ id: "room-0", title: "First" });
  expect(update(first.model, Message.Refresh()).commands).toBeUndefined();
  expect(update(first.model, Message.Select({ id: "" })).model.selected).toBe(
    "__all__",
  );
  const second = update(first.model, Message.Deleted({ id: "room-0" }));
  expect(second.commands?.[0]?.args).toEqual({ id: "room-1", title: "Second" });
  expect(second.model.notice).toBe("Deleted 1 of 2 rooms.");
  const finished = update(second.model, Message.Deleted({ id: "room-1" }));
  expect(finished.model.rooms).toEqual([]);
  expect(finished.model.deleting).toBe(false);
  expect(finished.model.notice).toBe("Permanently deleted 2 rooms.");
});

it("stops on failure and retries only remaining rooms", () => {
  const first = update(base(), Message.DeleteAll()).model;
  const second = update(first, Message.Deleted({ id: "room-0" })).model;

  const failed = update(
    second,
    Message.Failed({ error: "Retry cleanup" }),
  ).model;

  expect(failed.deleting).toBe(false);
  const retry = update(failed, Message.DeleteAll());
  expect(retry.model.pending.map((r) => r.id)).toEqual(["room-1"]);
  expect(retry.commands?.[0]?.args).toEqual({ id: "room-1", title: "Second" });
});
