import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { init } from "../src/application/init.ts";
import { Message } from "../src/application/definition.ts";
import { update } from "../src/application/update.ts";
import { updateWithDrafts } from "../src/draftPersistence.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const base = () =>
  init({
    actorId: "session",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Host",
  }).model;

const board = {
  ...emptyBoard,
  phase: "write" as const,
  grants: [{ sessionId: "session", participantId: "host" }],
};

const enter = () =>
  updateWithDrafts(base(), Message.Entered({ roomId: "room", board })).model;

let stored: Record<string, string>;

beforeEach(() => {
  stored = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: (key: string) => {
      delete stored[key];
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

it("restores each category after refresh, scoped to room and participant", () => {
  let model = updateWithDrafts(
    enter(),
    Message.Field({ field: "draft", value: "Mad draft" }),
  ).model;

  model = updateWithDrafts(
    model,
    Message.MobileColumn({ column: "sad" }),
  ).model;
  updateWithDrafts(
    model,
    Message.Field({ field: "draft", value: "Sad draft" }),
  );
  expect(enter().drafts).toEqual({
    mad: "Mad draft",
    sad: "Sad draft",
  });

  const other = updateWithDrafts(
    base(),
    Message.Entered({ roomId: "other", board }),
  ).model;

  expect(other.draft).toBe("");

  const person = updateWithDrafts(
    base(),
    Message.Entered({
      roomId: "room",
      board: {
        ...board,
        grants: [{ sessionId: "session", participantId: "guest" }],
      },
    }),
  ).model;

  expect(person.draft).toBe("");
});

it("retains a stable note id through a failed save and reload, then clears only the saved draft", () => {
  let model = updateWithDrafts(
    enter(),
    Message.Field({ field: "draft", value: "Retry me" }),
  ).model;

  const first = updateWithDrafts(
    model,
    Message.Run({ op: "save", id: "", selected: false }),
  );

  const id = first.commands?.[0]?.args?.id;
  expect(id).toBeTruthy();
  model = updateWithDrafts(
    first.model,
    Message.Failed({ reason: "Lost acknowledgement" }),
  ).model;
  expect(model.draft).toBe("Retry me");

  const retry = updateWithDrafts(
    enter(),
    Message.Run({ op: "save", id: "", selected: false }),
  );

  expect(retry.commands?.[0]?.args?.id).toBe(id);
  updateWithDrafts(retry.model, Message.Succeeded({ op: "save" }));
  expect(enter().draft).toBe("");
  expect(stored).toEqual({});
});

it("preserves a new draft while editing an existing note, and clears on closure", () => {
  const model = updateWithDrafts(
    enter(),
    Message.Field({ field: "draft", value: "New" }),
  ).model;

  const edit = updateWithDrafts(
    model,
    Message.Edit({ column: "mad", id: "old", text: "Existing" }),
  ).model;

  updateWithDrafts(edit, Message.Field({ field: "draft", value: "Edited" }));
  expect(enter().draft).toBe("New");
  updateWithDrafts(
    model,
    Message.Board({ board: { ...board, phase: "closed" } }),
  );
  expect(stored).toEqual({});
});

it("tolerates unavailable storage and reports that drafts cannot be backed up", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {
      throw new Error("Quota");
    },
  });

  const result = updateWithDrafts(
    enter(),
    Message.Field({ field: "draft", value: "Still here" }),
  ).model;

  expect(result.draft).toBe("Still here");
  expect(result.notice).toContain("Keep this tab open");
});

it("does not clear drafts on connection failure or reconnect", () => {
  const model = updateWithDrafts(
    enter(),
    Message.Field({ field: "draft", value: "Offline" }),
  ).model;

  const disconnected = update(
    model,
    Message.WatchFailed({ reason: "Offline" }),
  ).model;

  const retry = update(disconnected, Message.Retry()).model;
  expect(retry.draft).toBe("Offline");
  expect(retry.connected).toBe(false);
  expect(retry.reconnect).toBe(1);
});

it("clears the local backup when a room is deleted", () => {
  const model = updateWithDrafts(
    enter(),
    Message.Field({ field: "draft", value: "Private" }),
  ).model;

  updateWithDrafts(model, Message.RoomUnavailable());
  expect(stored).toEqual({});
});

it("ignores malformed backups without preventing entry or later saving", () => {
  stored["cg_drafts_v2:room:host"] = "{broken";
  const model = enter();
  expect(model.entered).toBe(true);
  expect(model.draft).toBe("");
  updateWithDrafts(
    model,
    Message.Field({ field: "draft", value: "Recovered" }),
  );
  expect(enter().draft).toBe("Recovered");
});
