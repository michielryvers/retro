import { describe, it, expect } from "vitest";
import { init } from "../src/application/init.ts";
import { update } from "../src/application/update.ts";
import { Message } from "../src/application/definition.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const base = () => ({
  ...init({
    participantId: "",
    inviteToken: "",
    actorId: "host",
    roomId: "room",
    name: "Alex",
  }).model,
  entered: true,
  board: {
    ...emptyBoard,
    title: "Sprint",
    adminId: "host",
    phase: "reveal" as const,
    notes: [
      { id: "a", text: "A", column: "mad" as const, authorId: "host" },
      { id: "b", text: "B", column: "sad" as const, authorId: "guest" },
    ],
  },
});

describe("combine interaction", () => {
  it("blocks combine and split outside Reveal and blocks participant splits", () => {
    expect(update(base(), Message.Split({ id: "b" })).commands).toHaveLength(1);

    for (const phase of ["write", "vote", "actions", "closed"] as const) {
      const m = {
        ...base(),
        board: { ...base().board, phase },
        dragSource: "a",
        mergeSource: "a",
        mergeTarget: "b",
      };

      expect(update(m, Message.Drop({ id: "b" })).commands).toBeUndefined();
      expect(update(m, Message.MergeConfirm()).commands).toBeUndefined();
      expect(update(m, Message.Split({ id: "b" })).commands).toBeUndefined();
    }

    expect(
      update({ ...base(), actorId: "guest" }, Message.Split({ id: "b" }))
        .commands,
    ).toBeUndefined();
  });
  it("combines immediately on drop without a confirmation picker", () => {
    const m = update(base(), Message.DragStart({ id: "a" })).model;
    const result = update(m, Message.Drop({ id: "b" }));
    expect(result.commands).toHaveLength(1);
    expect(result.model.busy).toBe(true);
    expect(update(result.model, Message.DragEnd()).model.busy).toBe(true);
  });
  it("does not submit self-drops or a participant's forged selection", () => {
    let m = update(base(), Message.DragStart({ id: "a" })).model;
    m = update(m, Message.Drop({ id: "a" })).model;
    expect(update(m, Message.MergeConfirm()).commands).toBeUndefined();
    expect(
      update(
        { ...base(), actorId: "guest", mergeSource: "a", mergeTarget: "b" },
        Message.MergeConfirm(),
      ).commands,
    ).toBeUndefined();
  });
  it("clears a stale selection when the room changes phase or a note disappears", () => {
    const m = { ...base(), mergeSource: "a", mergeTarget: "b" };

    const changed = update(
      m,
      Message.Board({ board: { ...m.board, phase: "vote" } }),
    ).model;

    expect([changed.mergeSource, changed.mergeTarget]).toEqual(["", ""]);
  });
});
