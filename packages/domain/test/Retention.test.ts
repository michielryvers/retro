import { RoomSummary } from "../src/Room/RoomSummary.view.ts";
import { CombineNotes } from "../src/Room/CombineNotes.command.ts";
import { SplitNote } from "../src/Room/SplitNote.command.ts";
import { SaveAction } from "../src/Room/SaveAction.command.ts";
import { DeleteAction } from "../src/Room/DeleteAction.command.ts";
import { MyNotes } from "../src/Room/MyNotes.view.ts";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Redacted from "effect/Redacted";
import { Story } from "@alchemy.run/domain/Story";
import { Retro } from "../src/Retro.model.ts";
import { Room } from "../src/Room/Room.aggregate.ts";
import { RoomRetentionLive } from "../src/Room/RoomRetention.policy.ts";
import { RoomCleanup } from "../src/Room/RoomCleanup.external.ts";
import { CreateRoom, RoomCreated } from "../src/Room/CreateRoom.command.ts";
import { CloseRoom, RoomClosed } from "../src/Room/CloseRoom.command.ts";
import { ExpireRoom } from "../src/Room/ExpireRoom.command.ts";
import { RequestRoomDeletion } from "../src/Room/RequestRoomDeletion.command.ts";
import { RevealNotes } from "../src/Room/RevealNotes.command.ts";
import { StartVoting } from "../src/Room/StartVoting.command.ts";
import { FinishVoting } from "../src/Room/FinishVoting.command.ts";
import { SaveNote, NoteSaved } from "../src/Room/SaveNote.command.ts";
import { ArchiveRoom } from "../src/Room/ArchiveRoom.command.ts";
import { SharedBoard } from "../src/Room/SharedBoard.view.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { PreparedAccess } from "../src/PreparedAccess.context.ts";
import { RETENTION_YEAR_MS } from "../src/Room/Retention.ts";
import { RoomRetentionScheduled } from "../src/Room/RoomRetentionScheduled.event.ts";

const story = Story.make(Retro, { layer: RoomRetentionLive, stub: [RoomCleanup], assertAllEvents: false });
const room = Room.ref("retention");
const start = Date.parse("2026-01-01T12:00:00Z");
const week = 7 * 24 * 60 * 60 * 1000;
const year = RETENTION_YEAR_MS;

const setup = [
  Story.clock(start),
  Story.provide(CurrentActor, { id: "host" }),
  Story.provide(PreparedAccess, {
    id: "host", seed: Redacted.make("seed"), salt: "salt", hash: Redacted.make("hash"), validToken: true,
  }),
  Story.when(room, new CreateRoom({ title: "Retention test", name: "Host", template: "mad-sad-glad", password: Redacted.make("abc") })),
];

it.effect("keeps an unfinished room for a year without revealing private notes, then retains it for a year after closure", () => story(
  ...setup,
  Story.when(room, new SaveNote({ id: "secret", column: "mad", text: "Keep this private" })),
  Story.clock(start + week - 1),
  Story.when(room, new ExpireRoom({})),
  Story.state(room, (s) => expect(s.phase).toBe("write")),
  Story.clock(start + week),
  Story.state(room, (s) => expect(s.phase).toBe("write")),
  Story.clock(start + year - 1),
  Story.state(room, (s) => expect(s.phase).toBe("write")),
  Story.clock(start + year),
  Story.state(room, (s) => expect(s.closedAt).toBe(start + year)),
  Story.view(SharedBoard, room, (s) => {
    expect(s?.phase).toBe("closed");
    expect(s?.notes).toEqual([]);
    expect(s?.deletesAt).toBe(start + 2 * year);
  }),
  Story.clock(start + 2 * year - 1),
  Story.when(room, new RequestRoomDeletion({})),
  Story.clock(start + 2 * year),
  Story.call(RoomCleanup.remove, { id: room.id, title: "Retention test" }),
  Story.succeed(RoomCleanup.remove, { deleted: true }),
));

it.effect("retains an early conclusion for one year; stale expiry and archive cannot change its deadline", () => story(
  ...setup,
  Story.when(room, new RevealNotes({})),
  Story.when(room, new StartVoting({})),
  Story.when(room, new FinishVoting({})),
  Story.clock(start + 3600000),
  Story.when(room, new CloseRoom({})),
  Story.when(room, new ArchiveRoom({ archived: true })),
  Story.view(SharedBoard, room, (s) => expect(s?.deletesAt).toBe(start + 3600000 + year)),
  Story.clock(start + week),
  Story.state(room, (s) => expect(s.closedAt).toBe(start + 3600000)),
  Story.when(room, new ArchiveRoom({ archived: false })),
  Story.clock(start + year + 3600000 - 1),
  Story.when(room, new RequestRoomDeletion({})),
  Story.clock(start + year + 3600000),
  Story.call(RoomCleanup.remove, { id: room.id }),
  Story.succeed(RoomCleanup.remove, { deleted: true }),
));

it.effect("late expiry uses the original deadline instead of extending the room lifetime", () => story(
  ...setup,
  Story.clock(start + 3 * year),
  Story.state(room, (s) => expect(s.closedAt).toBe(start + year)),
  Story.call(RoomCleanup.remove, { id: room.id }),
  Story.succeed(RoomCleanup.remove, { deleted: true }),
));

it.effect("keeps compact summary counts correct without full-board event histories", () => story(
  ...setup,
  Story.when(room, new SaveNote({ id: "a", column: "mad", text: "One" })),
  Story.when(room, new SaveNote({ id: "b", column: "sad", text: "Two" })),
  Story.when(room, new RevealNotes({})),
  Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
  Story.view(RoomSummary, room, (s) => expect(s?.notes).toBe(1)),
  Story.when(room, new SplitNote({ noteId: "b" })),
  Story.view(RoomSummary, room, (s) => expect(s?.notes).toBe(2)),
  Story.when(room, new StartVoting({})),
  Story.when(room, new FinishVoting({})),
  Story.when(room, new SaveAction({ id: "action", noteId: "a", text: "Try this", ownerId: "", dueDate: "" })),
  Story.when(room, new SaveAction({ id: "action", noteId: "a", text: "Edited", ownerId: "", dueDate: "" })),
  Story.view(RoomSummary, room, (s) => expect(s?.actions).toBe(1)),
  Story.when(room, new DeleteAction({ id: "action" })),
  Story.when(room, new CloseRoom({})),
  Story.view(RoomSummary, room, (s) => expect(s).toMatchObject({ participants: 1, notes: 2, actions: 0, phase: "closed" })),
  Story.emitted(SharedBoard, room, []),
  Story.emitted(MyNotes, Room.ref("retention:host"), []),
));

// Seed historical events, not rewritten aggregate snapshots or replacement IDs.
const legacy = [
  Story.clock(start),
  Story.given(room, new RoomCreated({
    title: "Existing retro", template: "mad-sad-glad", name: "Host", adminId: "host", sessionId: "device",
    inviteSeed: Redacted.make("existing-seed"), passwordSalt: "existing-salt", passwordHash: Redacted.make("existing-hash"),
  }), new NoteSaved({ note: { id: "private", column: "mad", text: "Private existing note", authorId: "host" } })),
  Story.provide(CurrentActor, { id: "device" }),
];

it.effect("reschedules a legacy seven-day expiry without changing identities, secrets or private notes", () => story(
  ...legacy,
  Story.clock(start + week),
  Story.when(room, new ExpireRoom({})),
  Story.then(room, new RoomRetentionScheduled({ operation: "close", at: start + year })),
  Story.state(room, (s) => {
    expect(s.phase).toBe("write");
    expect(s.createdAt).toBe(start);
    expect(s.grants).toEqual([{ participantId: "host", sessionId: "device" }]);
    expect(Redacted.value(s.inviteSeed)).toBe("existing-seed");
    expect(s.passwordSalt).toBe("existing-salt");
    expect(Redacted.value(s.passwordHash)).toBe("existing-hash");
    expect(s.notes[0]?.text).toBe("Private existing note");
  }),
  Story.view(SharedBoard, room, (s) => expect(s?.notes).toEqual([])),
  Story.view(MyNotes, Room.ref("retention:host"), (s) => expect(s?.notes[0]?.text).toBe("Private existing note")),
  Story.clock(start + year),
  Story.state(room, (s) => {
    expect(s.closedAt).toBe(start + year);
    expect(s.notes[0]?.text).toBe("Private existing note");
  }),
));

it.effect("reschedules a legacy closed-room timer and deletes only at the extended deadline", () => story(
  ...legacy,
  Story.given(room, new RoomClosed({ closedAt: start })),
  Story.clock(start + week),
  Story.when(room, new RequestRoomDeletion({})),
  Story.then(room, new RoomRetentionScheduled({ operation: "delete", at: start + year })),
  Story.when(room, new RequestRoomDeletion({})),
  Story.then(room, new RoomRetentionScheduled({ operation: "delete", at: start + year })),
  Story.view(SharedBoard, room, (s) => expect(s?.deletesAt).toBe(start + year)),
  Story.clock(start + year - 1),
  Story.state(room, (s) => expect(s.notes[0]?.text).toBe("Private existing note")),
  Story.clock(start + year),
  Story.call(RoomCleanup.remove, { id: room.id, title: "Existing retro" }),
  Story.succeed(RoomCleanup.remove, { deleted: true }),
));
