import { expect, it } from "vitest";
import { CombiningBlock } from "../src/features/Combining.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const { Message } = CombiningBlock;

const context = {
  roomId: "room",
  actorId: "host",
  busy: false,
  board: {
    ...emptyBoard,
    adminId: "host",
    phase: "reveal" as const,
    notes: [
      { id: "a", text: "A", column: "mad", authorId: "host" },
      { id: "b", text: "B", column: "sad", authorId: "guest" },
    ],
  },
};

it("combines immediately on drop and keeps in-flight status through drag end", () => {
  const m = CombiningBlock.update(
    CombiningBlock.init().model,
    Message.DragStart({ id: "a" }),
    context,
  ).model;

  const result = CombiningBlock.update(m, Message.Drop({ id: "b" }), context);
  expect(result.commands?.[0]?.args).toEqual({
    roomId: "room",
    sourceId: "a",
    targetId: "b",
  });
  expect(
    CombiningBlock.update(result.model, Message.DragEnd(), context).model.busy,
  ).toBe(true);
});

it("blocks combine and split outside reveal, participant requests, and self-drops", () => {
  const m = { ...CombiningBlock.init().model, dragSource: "a" };

  for (const phase of ["write", "vote", "actions", "closed"] as const)
    for (const msg of [Message.Drop({ id: "b" }), Message.Split({ id: "b" })])
      expect(
        CombiningBlock.update(m, msg, {
          ...context,
          board: { ...context.board, phase },
        }).commands,
      ).toBeUndefined();
  expect(
    CombiningBlock.update(m, Message.Split({ id: "b" }), {
      ...context,
      actorId: "guest",
    }).commands,
  ).toBeUndefined();
  expect(
    CombiningBlock.update(m, Message.Drop({ id: "a" }), context).commands,
  ).toBeUndefined();
});

it("clears a stale drag when permission or phase changes", () => {
  const m = {
    ...CombiningBlock.init().model,
    dragSource: "a",
    dropTarget: "b",
  };

  const result = CombiningBlock.update(m, Message.InformedOfRoom(), {
    ...context,
    board: { ...context.board, phase: "vote" },
  });

  expect(result.model).toMatchObject({ dragSource: "", dropTarget: "" });
});
