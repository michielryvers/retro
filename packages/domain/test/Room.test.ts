import { RoomRetentionLive } from "../src/Room/RoomRetention.policy.ts";
import { RoomCleanup } from "../src/Room/RoomCleanup.external.ts";
import { PreparedAccess } from "../src/PreparedAccess.context.ts";
import * as Redacted from "effect/Redacted";
import { DeleteAction } from "../src/Room/DeleteAction.command.ts";
import { ParticipantInvited } from "../src/Room/InviteParticipant.command.ts";
import {
  SessionGranted,
  ParticipantJoined,
} from "../src/Room/JoinRoom.command.ts";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import { Story } from "@alchemy.run/domain/Story";
import { Room, ROOM_STATE_LIMIT } from "../src/Room/Room.aggregate.ts";
import { Retro } from "../src/Retro.model.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { CreateRoom, RoomCreated } from "../src/Room/CreateRoom.command.ts";

import { SaveNote, NoteSaved } from "../src/Room/SaveNote.command.ts";
import { TallyChanged } from "../src/Room/TallyChanged.event.ts";
import { DeleteNote, NoteDeleted } from "../src/Room/DeleteNote.command.ts";
import { RevealNotes } from "../src/Room/RevealNotes.command.ts";
import { StartVoting } from "../src/Room/StartVoting.command.ts";
import { SetVote } from "../src/Room/SetVote.command.ts";

import { FinishVoting } from "../src/Room/FinishVoting.command.ts";
import { SaveAction } from "../src/Room/SaveAction.command.ts";
import { CloseRoom } from "../src/Room/CloseRoom.command.ts";
import { Refused } from "../src/Room/Refused.rejection.ts";
import { SharedBoard } from "../src/Room/SharedBoard.view.ts";
import { MyNotes } from "../src/Room/MyNotes.view.ts";

const story = Story.make(Retro, { layer: RoomRetentionLive, stub: [RoomCleanup] });
const room = Room.ref("room");

const setup = [
  Story.given(
    room,
    new RoomCreated({
      template: "mad-sad-glad",
      title: "Retro",
      name: "Host",
      adminId: "host",
      sessionId: "host",
      inviteSeed: Redacted.make("seed"),
      passwordSalt: "salt",
      passwordHash: Redacted.make("hash"),
    }),
    new ParticipantInvited({ id: "guest", name: "Guest" }),
    new ParticipantJoined({ id: "guest", name: "Guest" }),
    new SessionGranted({ participantId: "guest", sessionId: "guest" }),
  ),
  Story.provide(CurrentActor, { id: "guest" }),
];

it.effect("keeps drafts private until the facilitator reveals them", () =>
  story(
    ...setup,
    Story.when(
      room,
      new SaveNote({ id: "n1", column: "sad", text: "A sensitive concern" }),
    ),
    Story.view(SharedBoard, room, (s) => {
      expect(s?.notes).toEqual([]);
      expect(s?.tally.sad).toBe(1);
    }),
    Story.view(MyNotes, Room.ref("room:guest"), (s) =>
      expect(s?.notes[0]?.text).toBe("A sensitive concern"),
    ),
    Story.when(room, new RevealNotes({})),
    Story.rejected(
      new Refused({ reason: "Only the facilitator can do that." }),
    ),
    Story.provide(CurrentActor, { id: "host" }),
    Story.when(room, new RevealNotes({})),
    Story.view(SharedBoard, room, (s) =>
      expect(s?.notes[0]?.text).toBe("A sensitive concern"),
    ),
    Story.when(
      room,
      new SaveNote({ id: "late", column: "glad", text: "Too late" }),
    ),
    Story.rejected(
      new Refused({
        reason: "The session has moved on. Refresh your board and try again.",
      }),
    ),
  ),
);

it.effect("prevents editing or deleting another participant’s note", () =>
  story(
    ...setup,
    Story.when(
      room,
      new SaveNote({ id: "n1", column: "mad", text: "My note" }),
    ),
    Story.provide(CurrentActor, { id: "host" }),
    Story.when(
      room,
      new SaveNote({ id: "n1", column: "glad", text: "Changed" }),
    ),
    Story.rejected(
      new Refused({ reason: "You can only edit your own notes." }),
    ),
    Story.when(room, new DeleteNote({ id: "n1" })),
    Story.rejected(
      new Refused({ reason: "You can only delete your own notes." }),
    ),
  ),
);

it.effect(
  "enforces a three-vote budget and reveals totals only when voting ends",
  () =>
    story(
      ...setup,
      ...["a", "b", "c", "d"].map((id) =>
        Story.when(
          room,
          new SaveNote({ id, column: "glad", text: `Note ${id}` }),
        ),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new RevealNotes({})),
      Story.when(room, new StartVoting({})),
      ...["a", "b", "c"].map((noteId) =>
        Story.when(room, new SetVote({ noteId, selected: true })),
      ),
      Story.when(room, new SetVote({ noteId: "c", selected: true })),
      Story.when(room, new SetVote({ noteId: "d", selected: true })),
      Story.rejected(
        new Refused({
          reason: "You have used all 3 votes. Remove one to vote here.",
        }),
      ),
      Story.view(SharedBoard, room, (s) => expect(s?.scores).toEqual([])),
      Story.when(room, new SetVote({ noteId: "b", selected: false })),
      Story.when(room, new SetVote({ noteId: "d", selected: true })),
      Story.when(room, new FinishVoting({})),
      Story.view(SharedBoard, room, (s) =>
        expect(s?.scores).toEqual([
          { noteId: "a", count: 1 },
          { noteId: "b", count: 0 },
          { noteId: "c", count: 1 },
          { noteId: "d", count: 1 },
        ]),
      ),
      Story.when(
        room,
        new SaveAction({
          id: "action",
          noteId: "a",
          text: "Make time for pairing",
          ownerId: "guest",
          dueDate: "2026-11-01",
        }),
      ),
      Story.when(room, new CloseRoom({})),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.phase).toBe("closed");
        expect(s?.actions[0]?.ownerId).toBe("guest");
      }),
    ),
);

// Private projections route only owner-scoped events. The last event of a
// note command must reach MyNotes so its checkpoint can satisfy the receipt.
it.effect("ends note commands with the event routed to the private view", () =>
  story(
    Story.given(
      room,
      new RoomCreated({
        template: "mad-sad-glad",
        title: "Sprint",
        adminId: "host",
        name: "Alex",
        sessionId: "host",
        inviteSeed: Redacted.make("seed"),
        passwordSalt: "salt",
        passwordHash: Redacted.make("hash"),
      }),
    ),
    Story.provide(CurrentActor, { id: "host" }),
    Story.when(room, new SaveNote({ id: "n", column: "mad", text: "Focus" })),
    Story.then(
      room,
      new TallyChanged({ tally: { mad: 1, sad: 0, glad: 0 } }),
      new NoteSaved({
        note: { id: "n", column: "mad", text: "Focus", authorId: "host" },
      }),
    ),
    Story.when(room, new DeleteNote({ id: "n" })),
    Story.then(
      room,
      new TallyChanged({ tally: { mad: 0, sad: 0, glad: 0 } }),
      new NoteDeleted({ id: "n", authorId: "host" }),
    ),
  ),
);

it.effect("keeps the chosen template in the shared board", () =>
  story(
    Story.provide(CurrentActor, { id: "host" }),
    Story.provide(PreparedAccess, {
      id: "host",
      seed: Redacted.make("seed"),
      salt: "salt",
      hash: Redacted.make("hash"),
      validToken: false,
    }),
    Story.when(
      room,
      new CreateRoom({
        password: Redacted.make("test-room-password-2026"),
        title: "Habits",
        name: "Alex",
        template: "start-stop-continue",
      }),
    ),
    Story.view(SharedBoard, room, (s) =>
      expect(s?.template).toBe("start-stop-continue"),
    ),
  ),
);

it.effect("defaults room creation to Mad / Sad / Glad", () =>
  story(
    ...setup,
    Story.view(SharedBoard, room, (s) =>
      expect(s?.template).toBe("mad-sad-glad"),
    ),
  ),
);

import { CombineNotes } from "../src/Room/CombineNotes.command.ts";

it.effect(
  "only the facilitator can combine revealed notes; rejects self and stale merges",
  () =>
    story(
      ...setup,
      Story.when(
        room,
        new SaveNote({ id: "a", column: "mad", text: "Too many meetings" }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(
        room,
        new SaveNote({ id: "b", column: "sad", text: "Not enough focus time" }),
      ),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
      Story.when(room, new RevealNotes({})),
      Story.provide(CurrentActor, { id: "guest" }),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "a" })),
      Story.rejected(
        new Refused({ reason: "Choose two different notes to combine." }),
      ),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.notes).toHaveLength(1);
        expect(s?.notes[0]?.parts?.map((p) => p.authorId)).toEqual([
          "host",
          "guest",
        ]);
        expect(s?.notes[0]?.text).toContain("Too many meetings");
        expect(s?.tally).toEqual({ mad: 0, sad: 1, glad: 0 });
      }),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.rejected(
        new Refused({
          reason:
            "One of these notes has already been combined. Choose the notes again.",
        }),
      ),
    ),
);

it.effect(
  "rejects combining during voting, actions and closed without changing notes",
  () =>
    story(
      ...setup,
      Story.when(
        room,
        new SaveNote({ id: "a", column: "mad", text: "Meetings" }),
      ),
      Story.when(
        room,
        new SaveNote({ id: "b", column: "mad", text: "Focus time" }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new RevealNotes({})),
      Story.when(room, new StartVoting({})),
      Story.when(room, new SetVote({ noteId: "a", selected: true })),
      Story.when(room, new SetVote({ noteId: "b", selected: true })),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
      Story.when(room, new FinishVoting({})),
      Story.when(
        room,
        new SaveAction({
          id: "action",
          noteId: "a",
          text: "Protect mornings",
          ownerId: "host",
          dueDate: "2026-10-30",
        }),
      ),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.notes).toHaveLength(2);
        expect(s?.scores).toEqual([
          { noteId: "a", count: 1 },
          { noteId: "b", count: 1 },
        ]);
        expect(s?.actions[0]?.noteId).toBe("a");
      }),
      Story.when(room, new CloseRoom({})),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
    ),
);

it.effect(
  "rejects storage growth in oversized rooms but permits shrinking existing content",
  () =>
    story(
      ...setup,
      Story.given(
        room,
        ...Array.from(
          { length: 299 },
          (_, index) =>
            new NoteSaved({
              note: {
                id: `large-${index}`,
                column: "sad",
                text: "界".repeat(2000),
                authorId: "guest",
              },
            }),
        ),
      ),
      Story.when(
        room,
        new SaveNote({ id: "overflow", column: "glad", text: "More content" }),
      ),
      Story.rejected(
        new Refused({
          reason:
            "This room is full. Shorten or remove some content before adding more.",
        }),
      ),
      Story.when(
        room,
        new SaveNote({ id: "large-0", column: "sad", text: "Shortened" }),
      ),
      Story.view(MyNotes, Room.ref("room:guest"), (s) =>
        expect(s?.notes.find((note) => note.id === "large-0")?.text).toBe(
          "Shortened",
        ),
      ),
    ),
);

it.effect(
  "only the facilitator can create, edit and delete actions; completion is disabled",
  () =>
    story(
      ...setup,
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(
        room,
        new SaveNote({ id: "note", column: "mad", text: "Deployments" }),
      ),
      Story.when(room, new RevealNotes({})),
      Story.when(room, new StartVoting({})),
      Story.when(room, new FinishVoting({})),
      Story.provide(CurrentActor, { id: "guest" }),
      Story.when(
        room,
        new SaveAction({
          id: "action",
          noteId: "note",
          text: "Draft",
          ownerId: "guest",
          dueDate: "",
        }),
      ),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(
        room,
        new SaveAction({
          id: "action",
          noteId: "note",
          text: "Draft",
          ownerId: "guest",
          dueDate: "",
        }),
      ),
      Story.provide(CurrentActor, { id: "guest" }),
      Story.when(
        room,
        new SaveAction({
          id: "action",
          noteId: "note",
          text: "Unauthorized edit",
          ownerId: "guest",
          dueDate: "",
        }),
      ),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
      Story.when(room, new DeleteAction({ id: "action" })),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(
        room,
        new SaveAction({
          id: "action",
          noteId: "note",
          text: "Updated",
          ownerId: "host",
          dueDate: "2026-11-01",
        }),
      ),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.actions).toHaveLength(1);
        expect(s?.actions[0]).toMatchObject({
          text: "Updated",
          ownerId: "host",
          dueDate: "2026-11-01",
        });
      }),
      Story.when(room, new DeleteAction({ id: "action" })),
      Story.view(SharedBoard, room, (s) => expect(s?.actions).toEqual([])),
    ),
);

it.effect("stores only IDs for a long chain of combinations", () =>
  story(
    ...setup,
    Story.provide(CurrentActor, { id: "host" }),
    ...Array.from({ length: 100 }, (_, i) => Story.when(room,
      new SaveNote({ id: String(i), column: "mad", text: "x".repeat(2000) }))),
    Story.when(room, new RevealNotes({})),
    ...Array.from({ length: 99 }, (_, i) => Story.when(room,
      new CombineNotes({ sourceId: String(i + 1), targetId: "0" }))),
    Story.state(room, (s) => {
      expect(s.notes).toHaveLength(100);
      expect(s.combinations).toHaveLength(99);
      expect(s.combinations[0]).toEqual({ sourceId: "1", targetId: "0" });
      expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThan(220_000);
    }),
    Story.view(SharedBoard, room, (s) => {
      expect(s?.notes).toHaveLength(1);
      expect(s?.notes[0]?.parts).toHaveLength(100);
    }),
    Story.when(room, new StartVoting({})),
    Story.when(room, new SetVote({ noteId: "1", selected: true })),
    Story.rejected(new Refused({ reason: "That note no longer exists." })),
    Story.when(room, new SetVote({ noteId: "0", selected: true })),
    Story.when(room, new FinishVoting({})),
    Story.view(SharedBoard, room, (s) => {
      expect(s?.notes).toHaveLength(1);
      expect(s?.scores).toEqual([{ noteId: "0", count: 1 }]);
    }),
  ),
);

it.effect("allows more than 768 KiB but refuses UTF-8 state above 1.8 MB", () =>
  story(
    ...setup,
    Story.provide(CurrentActor, { id: "host" }),
    ...Array.from({ length: 297 }, (_, i) => Story.when(room,
      new SaveNote({ id: String(i), column: "mad", text: "界".repeat(2000) }))),
    Story.state(room, (s) => {
      const bytes = new TextEncoder().encode(JSON.stringify(s)).length;
      expect(bytes).toBeGreaterThan(768 * 1024);
      expect(bytes).toBeLessThan(ROOM_STATE_LIMIT);
    }),
    Story.when(room, new SaveNote({ id: "298", column: "mad", text: "界".repeat(2000) })),
    Story.rejected(new Refused({ reason: "This room is full. Shorten or remove some content before adding more." })),
    Story.state(room, (s) => expect(s.notes).toHaveLength(297)),
    Story.when(room, new RevealNotes({})),
    Story.when(room, new CombineNotes({ sourceId: "1", targetId: "0" })),
    Story.rejected(new Refused({ reason: "This room is full. Shorten or remove some content before adding more." })),
    Story.view(SharedBoard, room, (s) => expect(s?.notes).toHaveLength(297)),
  ),
);

import { templates, columnsFor, type Template } from "../src/Room/Templates.ts";

// SAFETY: templates is the exhaustive registry keyed by the Template literals.
for (const template of Object.keys(templates) as Template[]) {
  it.effect(`validates and counts notes using ${template} columns`, () =>
    story(
      Story.provide(CurrentActor, { id: "host" }),
      Story.given(room, new RoomCreated({
        template, title: "Format test", name: "Host", adminId: "host", sessionId: "host",
        inviteSeed: Redacted.make("seed"), passwordSalt: "salt", passwordHash: Redacted.make("hash"),
      })),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.tally).toEqual(Object.fromEntries(columnsFor(template).map((c) => [c.id, 0])));
      }),
      ...columnsFor(template).map((c) => Story.when(room, new SaveNote({ id: c.id, column: c.id, text: c.title }))),
      Story.when(room, new SaveNote({ id: "bad", column: "not-in-this-format", text: "Reject me" })),
      Story.rejected(new Refused({ reason: "Choose a column in this room’s format." })),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.tally).toEqual(Object.fromEntries(columnsFor(template).map((c) => [c.id, 1])));
        expect(s?.notes).toEqual([]);
      }),
      Story.when(room, new RevealNotes({})),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.notes.map((n) => n.column)).toEqual(columnsFor(template).map((c) => c.id));
      }),
    ),
  );
}
