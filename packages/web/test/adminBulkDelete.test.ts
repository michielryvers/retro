import { expect, it } from "vitest";
import { AdminDeletionBlock } from "../src/features/AdminDeletion.ts";

const { Message } = AdminDeletionBlock;

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

const context = { rooms, loading: false };

const base = () => ({
  ...AdminDeletionBlock.init().model,
  selected: "__all__",
  confirmation: "DELETE ALL",
});

it("requires explicit confirmation and an idle loaded list", () => {
  for (const m of [
    { ...base(), confirmation: "" },
    { ...base(), selected: "" },
    { ...base(), deleting: true },
  ])
    expect(
      AdminDeletionBlock.update(m, Message.DeleteAll(), context).commands,
    ).toBeUndefined();

  for (const c of [
    { ...context, loading: true },
    { ...context, rooms: [] },
  ])
    expect(
      AdminDeletionBlock.update(base(), Message.DeleteAll(), c).commands,
    ).toBeUndefined();
});

it("deletes the confirmed snapshot sequentially and reports every removal to the parent", () => {
  const first = AdminDeletionBlock.update(base(), Message.DeleteAll(), context);
  expect(first.model.pending).toHaveLength(2);
  expect(first.commands?.[0]?.args).toEqual({ id: "room-0", title: "First" });
  expect(
    AdminDeletionBlock.update(first.model, Message.Select({ id: "" }), context)
      .model.selected,
  ).toBe("__all__");

  const second = AdminDeletionBlock.update(
    first.model,
    Message.Deleted({ id: "room-0" }),
    context,
  );

  expect(second.outMessage).toMatchObject({ id: "room-0", refresh: false });
  expect(second.commands?.[0]?.args).toEqual({ id: "room-1", title: "Second" });
  expect(second.model.notice).toBe("Deleted 1 of 2 rooms.");

  const done = AdminDeletionBlock.update(
    second.model,
    Message.Deleted({ id: "room-1" }),
    context,
  );

  expect(done.outMessage).toMatchObject({ id: "room-1", refresh: true });
  expect(done.model.deleting).toBe(false);
  expect(done.model.notice).toBe("Permanently deleted 2 rooms.");
});

it("stops on failure and retries the parent's remaining rooms", () => {
  const first = AdminDeletionBlock.update(
    base(),
    Message.DeleteAll(),
    context,
  ).model;

  const second = AdminDeletionBlock.update(
    first,
    Message.Deleted({ id: "room-0" }),
    context,
  ).model;

  const failed = AdminDeletionBlock.update(
    second,
    Message.Failed({ error: "Retry cleanup" }),
    context,
  ).model;

  expect(failed.deleting).toBe(false);

  const retry = AdminDeletionBlock.update(failed, Message.DeleteAll(), {
    ...context,
    rooms: rooms.slice(1),
  });

  expect(retry.model.pending.map((r) => r.id)).toEqual(["room-1"]);
});
