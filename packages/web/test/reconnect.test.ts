import { expect, it } from "vitest";
import { init, Message, update } from "../src/App.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

it("restarts both live reads on return without discarding an in-flight edit", () => {
  const initial = init({
    actorId: "guest",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Guest",
  }).model;

  const before = {
    ...initial,
    entered: true,
    connected: true,
    busy: true,
    board: { ...emptyBoard, phase: "reveal" as const },
    draft: "Unsaved note",
    drafts: { mad: "Unsaved note" },
    private: { notes: [], votes: [], sessions: [] },
  };

  const after = update(before, Message.CheckRoom());
  expect(after.model.reconnect).toBe(before.reconnect + 1);
  expect(after.model.connected).toBe(false);
  expect(after.model.draft).toBe(before.draft);
  expect(after.model.drafts).toBe(before.drafts);
  expect(after.model.busy).toBe(true);
  expect(after.commands).toBeUndefined();

  const caughtUp = update(
    after.model,
    Message.Board({ board: { ...emptyBoard, phase: "vote" } }),
  ).model;

  expect(caughtUp.board?.phase).toBe("vote");
  expect(caughtUp.connected).toBe(true);
});

it("does not open subscriptions for a visitor who has not joined", () => {
  const model = init({
    actorId: "guest",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Guest",
  }).model;

  expect(update(model, Message.CheckRoom()).model).toBe(model);
});
