import { expect, it } from "vitest";
import { LifecycleBlock } from "../src/features/Lifecycle.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const context = {
  roomId: "room",
  actorId: "host",
  busy: false,
  voteSort: "highest" as const,
  board: {
    ...emptyBoard,
    title: "Sprint",
    adminId: "host",
    phase: "closed" as const,
  },
};

it("requires a finished room, facilitator, exact name and idle state", () => {
  const m = { ...LifecycleBlock.init().model, deleteTitle: "Sprint" };
  expect(
    LifecycleBlock.update(m, LifecycleBlock.Message.DeleteRoom(), context)
      .commands,
  ).toHaveLength(1);

  for (const c of [
    { ...context, actorId: "guest" },
    { ...context, busy: true },
    { ...context, board: { ...context.board, phase: "actions" as const } },
  ])
    expect(
      LifecycleBlock.update(m, LifecycleBlock.Message.DeleteRoom(), c).commands,
    ).toBeUndefined();
  expect(
    LifecycleBlock.update(
      { ...m, deleteTitle: "wrong" },
      LifecycleBlock.Message.DeleteRoom(),
      context,
    ).commands,
  ).toBeUndefined();
});

it("clears typed confirmation on cancel or reopen", () => {
  expect(
    LifecycleBlock.update(
      { ...LifecycleBlock.init().model, deleteTitle: "Sprint" },
      LifecycleBlock.Message.Cleanup(),
      context,
    ).model.deleteTitle,
  ).toBe("");
});
