import { describe, expect, it } from "vitest";
import { init, update, Message } from "../src/App.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const finished = () => ({
  ...init({
    participantId: "",
    inviteToken: "",
    actorId: "host",
    roomId: "room",
    name: "Alex",
  }).model,
  board: {
    ...emptyBoard,
    title: "Sprint",
    adminId: "host",
    phase: "closed" as const,
  },
  deleteTitle: "Sprint",
});

describe("finished room cleanup", () => {
  it("requires a finished room, facilitator, exact name and idle state", () => {
    const m = finished();
    expect(update(m, Message.DeleteRoom()).commands).toHaveLength(1);

    for (const invalid of [
      { ...m, actorId: "guest" },
      { ...m, deleteTitle: "wrong" },
      { ...m, busy: true },
      { ...m, board: { ...m.board, phase: "actions" as const } },
    ])
      expect(update(invalid, Message.DeleteRoom()).commands).toBeUndefined();
  });
  it("clears the typed confirmation on cancel or reopen", () => {
    const result = update(finished(), Message.Cleanup());
    expect(result.model.deleteTitle).toBe("");
  });
});
