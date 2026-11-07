import { expect, it } from "vitest";
import { init, Message, update } from "../src/App.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const board = {
  ...emptyBoard, phase: "reveal" as const, adminId: "host",
  grants: [{ sessionId: "device", participantId: "guest" }],
  notes: [
    { id: "a", column: "mad", text: "Meetings", authorId: "host" },
    { id: "b", column: "sad", text: "Focus time", authorId: "guest" },
  ],
};

const privateState = { sessions: ["device"], notes: [], votes: [] };

const entered = () => update(init({
  roomId: "room", actorId: "device", participantId: "", inviteToken: "", name: "Guest",
}).model, Message.Entered({ roomId: "room", board })).model;

const live = () => update(update(entered(), Message.Board({ board })).model, Message.Private({ state: privateState })).model;

it("does not claim to be Live merely because an HTTP entry request succeeded", () => {
  expect(entered().connected).toBe(false);
});

it("requires both the board and private subscription before claiming to be Live", () => {
  expect(update(entered(), Message.Board({ board })).model.connected).toBe(false);
  expect(update(entered(), Message.Private({ state: privateState })).model.connected).toBe(false);
  expect(live().connected).toBe(true);
});

it("does not let a board update hide a failed private subscription and cancel recovery", () => {
  const failed = update(live(), Message.WatchFailed({ reason: "Connection interrupted" })).model;
  const boardOnly = update(failed, Message.Board({ board })).model;

  expect(boardOnly.connected).toBe(false);
  expect(update(boardOnly, Message.Private({ state: privateState })).model.connected).toBe(true);
});

it("re-establishes subscriptions on returning to a room instead of just checking HTTP", () => {
  const model = { ...live(), draft: "Unsaved private draft", drafts: { mad: "Unsaved private draft" }, selected: "a" };
  const result = update(model, Message.CheckRoom());

  expect(result.model.reconnect).toBe(model.reconnect + 1);
  expect(result.model.connected).toBe(false);
  expect(result.model.draft).toBe(model.draft);
  expect(result.model.board).toBe(model.board);
  expect(result.commands ?? []).toEqual([]);
});

it("keeps recovery active when only the private stream has failed", () => {
  const failed = update(live(), Message.WatchFailed({ source: "private", reason: "Private stream lost" })).model;

  expect(failed.boardLive).toBe(true);
  expect(failed.privateLive).toBe(false);
  expect(update(failed, Message.Board({ board })).model.connected).toBe(false);
  expect(update(failed, Message.Private({ state: privateState })).model.connected).toBe(true);
});

it("keeps recovery active when only the board stream has failed", () => {
  const failed = update(live(), Message.WatchFailed({ source: "board", reason: "Board stream lost" })).model;

  expect(failed.privateLive).toBe(true);
  expect(failed.boardLive).toBe(false);
  expect(update(failed, Message.Private({ state: privateState })).model.connected).toBe(false);
  expect(update(failed, Message.Board({ board })).model.connected).toBe(true);
});

it("ignores snapshots, errors and deletion messages queued by an older subscription", () => {
  const old = live();
  const retry = update(old, Message.Retry()).model;

  const fresh = update(update(retry, Message.Private({ state: privateState, epoch: retry.reconnect })).model,
    Message.Board({ board, epoch: retry.reconnect })).model;

  for (const message of [
    Message.Board({ board: null, epoch: old.reconnect }),
    Message.Private({ state: null, epoch: old.reconnect }),
    Message.WatchFailed({ source: "board", reason: "Old connection", epoch: old.reconnect }),
    Message.RoomUnavailable({ epoch: old.reconnect }),
  ]) expect(update(fresh, message).model).toBe(fresh);
});

it("resets readiness on retry while preserving notes, votes, drafts and an in-flight command", () => {
  const model = { ...live(), private: { ...privateState, votes: ["b"] }, draft: "Keep this", busy: true };
  const failed = update(model, Message.WatchFailed({ source: "private", reason: "Disconnected" }));
  const retry = update(failed.model, Message.Retry()).model;

  expect(failed.commands ?? []).toEqual([]);
  expect(retry.board).toBe(model.board);
  expect(retry.private).toBe(model.private);
  expect(retry.draft).toBe("Keep this");
  expect(retry.busy).toBe(true);
  expect([retry.connected, retry.boardLive, retry.privateLive]).toEqual([false, false, false]);
});

it("clears removed note selections and drag state when a teammate combines notes", () => {
  const model = { ...live(), selected: "a", mergeSource: "a", mergeTarget: "b", dragSource: "a", dropTarget: "a" };
  const combined = { ...board, notes: [{ ...board.notes[1]!, text: "Focus time — Meetings", parts: [board.notes[1]!, board.notes[0]!] }] };
  const result = update(model, Message.Board({ board: combined })).model;

  expect(result.board?.notes).toHaveLength(1);
  expect(result.board?.notes[0]?.parts).toHaveLength(2);
  expect([result.selected, result.mergeSource, result.dragSource, result.dropTarget]).toEqual(["", "", "", ""]);
});

it("does not restart a deleted room or interrupt a pending interaction on focus", () => {
  const pending = { ...live(), busy: true };
  const deleted = update(live(), Message.RoomUnavailable({})).model;

  expect(update(pending, Message.CheckRoom()).model).toBe(pending);
  expect(update(deleted, Message.CheckRoom()).model).toBe(deleted);
  expect(update(deleted, Message.Retry()).model).toBe(deleted);
});

it("does not carry private state or accept old-room frames when entering a different room", () => {
  const model = { ...live(), private: { ...privateState, votes: ["a"] } };
  const next = update(model, Message.Entered({ roomId: "another-room", board })).model;

  expect(next.private).toEqual({ sessions: [], notes: [], votes: [] });
  expect(next.connected).toBe(false);
  expect(next.reconnect).toBe(model.reconnect + 1);
  expect(update(next, Message.Private({ state: model.private, epoch: model.reconnect })).model).toBe(next);
});
