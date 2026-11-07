import { expect, it } from "vitest";
import { init, Message, update } from "../src/App.ts";
import { emptyBoard } from "@retro/domain/Room/Values";
import { availableVotes, phaseConfirmation } from "../src/roomProgress.ts";

const base = () => ({
  ...init({ roomId: "room", actorId: "host", participantId: "", inviteToken: "", name: "Host" }).model,
  entered: true,
  board: { ...emptyBoard, adminId: "host" },
});

it("lets the facilitator save a budget before voting without optimistic state changes", () => {
  for (const phase of ["write", "reveal"] as const) {
    const model = { ...base(), board: { ...base().board, phase }, confirm: "startVote" };
    const result = update(model, Message.ConfigureVotes({ limit: 5 }));

    expect(result.commands).toHaveLength(1);
    expect(result.commands?.[0]?.args).toEqual({ roomId: "room", limit: 5 });
    expect(result.model.busy).toBe(true);
    expect(result.model.confirm).toBe("");
    expect(result.model.board?.voteLimit).toBe(3);
    const broadcast = update(result.model, Message.Board({ board: { ...model.board, voteLimit: 5 } })).model;
    const saved = update(broadcast, Message.VoteLimitSaved()).model;

    expect(saved.board?.voteLimit).toBe(5);
    expect(saved.busy).toBe(false);
  }
});

it("does not roll back newer live state when a configuration acknowledgement arrives late", () => {
  const saving = update(base(), Message.ConfigureVotes({ limit: 5 })).model;
  const newer = update(saving, Message.Board({ board: { ...base().board, phase: "vote", voteLimit: 2 } })).model;
  const acknowledged = update(newer, Message.VoteLimitSaved()).model;

  expect(acknowledged.board).toBe(newer.board);
  expect(acknowledged.board?.voteLimit).toBe(2);
  expect(acknowledged.board?.phase).toBe("vote");
  expect(acknowledged.busy).toBe(false);
});

it("preserves the authoritative budget and phase when a raced configuration request is rejected", () => {
  const saving = update(base(), Message.ConfigureVotes({ limit: 5 })).model;
  const started = update(saving, Message.Board({ board: { ...base().board, phase: "vote" } })).model;
  const rejected = update(started, Message.Failed({ reason: "The session has moved on." })).model;

  expect(rejected.board).toBe(started.board);
  expect(rejected.board?.voteLimit).toBe(3);
  expect(rejected.busy).toBe(false);
});

it("blocks participants, concurrent saves, unchanged values and changes after voting", () => {
  const model = base();

  for (const current of [
    { ...model, actorId: "guest" }, { ...model, busy: true },
    ...(["vote", "actions", "closed"] as const).map((phase) => ({ ...model, board: { ...model.board, phase } })),
  ]) expect(update(current, Message.ConfigureVotes({ limit: 5 })).commands).toBeUndefined();

  expect(update(model, Message.ConfigureVotes({ limit: 3 })).commands).toBeUndefined();

  for (const limit of [-1, 0, 31]) expect(update(model, Message.ConfigureVotes({ limit })).commands).toBeUndefined();
});

it("uses the configured effective budget in voting confirmations and note caps", () => {
  const notes = Array.from({ length: 6 }, (_, index) => ({ id: String(index), column: "mad", text: "Note", authorId: "host" }));
  const board = { ...base().board, notes, voteLimit: 5 };

  expect(availableVotes(board)).toBe(5);
  expect(phaseConfirmation(board, "startVote")).toContain("up to 5 notes");
  expect(availableVotes({ ...board, notes: notes.slice(0, 2) })).toBe(2);
  expect(phaseConfirmation({ ...board, voteLimit: 1 }, "startVote")).toContain("up to 1 note.");
});
