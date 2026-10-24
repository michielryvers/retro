import { RoomRetentionLive } from "../src/Room/RoomRetention.policy.ts";
import { RoomCleanup } from "../src/Room/RoomCleanup.external.ts";
import * as Redacted from "effect/Redacted";
import { ParticipantInvited } from "../src/Room/InviteParticipant.command.ts";
import {
  SessionGranted,
  ParticipantJoined,
} from "../src/Room/JoinRoom.command.ts";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import { Story } from "@alchemy.run/domain/Story";
import { Room } from "../src/Room/Room.aggregate.ts";
import { Retro } from "../src/Retro.model.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { RoomCreated } from "../src/Room/CreateRoom.command.ts";

import { SaveNote } from "../src/Room/SaveNote.command.ts";

import { RevealNotes } from "../src/Room/RevealNotes.command.ts";
import { StartVoting } from "../src/Room/StartVoting.command.ts";
import { SetVote } from "../src/Room/SetVote.command.ts";
import { SetVotingDone } from "../src/Room/SetVotingDone.command.ts";
import { FinishVoting } from "../src/Room/FinishVoting.command.ts";
import { CombineNotes } from "../src/Room/CombineNotes.command.ts";
import { SetTimer } from "../src/Room/SetTimer.command.ts";
import { Handover } from "../src/Room/Handover.command.ts";
import { UndoCombine } from "../src/Room/UndoCombine.command.ts";
import { SplitNote } from "../src/Room/SplitNote.command.ts";
import { SharedBoard } from "../src/Room/SharedBoard.view.ts";
import { Refused } from "../src/Room/Refused.rejection.ts";

const story = Story.make(Retro, { layer: RoomRetentionLive, stub: [RoomCleanup] });
const room = Room.ref("facilitation");

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

const notes = [
  Story.provide(CurrentActor, { id: "host" }),
  Story.when(room, new SaveNote({ id: "a", column: "mad", text: "First" })),
  Story.when(room, new SaveNote({ id: "b", column: "glad", text: "Second" })),
  Story.when(room, new RevealNotes({})),
];

it.effect(
  "restricts timers to the facilitator and persists pause, extend, resume and phase reset",
  () =>
    story(
      ...setup,
      Story.clock("2026-01-01T00:00:00Z"),
      Story.when(room, new SetTimer({ operation: "start", seconds: 300 })),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new SetTimer({ operation: "start", seconds: 300 })),
      Story.view(SharedBoard, room, (s) =>
        expect(s?.timer.endsAt).toBe(Date.parse("2026-01-01T00:05:00Z")),
      ),
      Story.when(room, new SetTimer({ operation: "pause", seconds: 0 })),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.timer?.endsAt).toBe(0);
        expect(s?.timer?.remainingMs).toBeGreaterThan(290000);
      }),
      Story.when(room, new SetTimer({ operation: "extend", seconds: 60 })),
      Story.view(SharedBoard, room, (s) =>
        expect(s?.timer?.remainingMs).toBeGreaterThan(350000),
      ),
      Story.when(room, new SetTimer({ operation: "resume", seconds: 0 })),
      ...notes,
      Story.view(SharedBoard, room, (s) =>
        expect(s?.timer).toEqual({ endsAt: 0, remainingMs: 0 }),
      ),
    ),
);

it.effect(
  "hands control over immediately and removes the previous facilitator’s permissions",
  () =>
    story(
      ...setup,
      Story.when(room, new Handover({ participantId: "host" })),
      Story.rejected(
        new Refused({
          reason: "Only the facilitator can hand over this room.",
        }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new Handover({ participantId: "guest" })),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.adminId).toBe("guest");
        expect(JSON.stringify(s)).not.toContain("recoveryHash");
      }),
      Story.when(room, new SetTimer({ operation: "start", seconds: 300 })),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
    ),
);

it.effect("splits revealed notes back into their original columns", () =>
  story(
    ...setup,
    ...notes,
    Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
    Story.when(room, new SplitNote({ noteId: "b" })),
    Story.view(SharedBoard, room, (s) => {
      expect(s?.notes.map((n) => n.id)).toEqual(["a", "b"]);
      expect(s?.tally).toEqual({ mad: 1, sad: 0, glad: 1 });
    }),
  ),
);

it.effect(
  "prevents participants undoing combinations and expires undo when voting starts",
  () =>
    story(
      ...setup,
      ...notes,
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.provide(CurrentActor, { id: "guest" }),
      Story.when(room, new UndoCombine({})),
      Story.rejected(
        new Refused({ reason: "Only the facilitator can do that." }),
      ),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new StartVoting({})),
      Story.when(room, new FinishVoting({})),
      Story.when(room, new UndoCombine({})),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
    ),
);

it.effect(
  "rejects splitting during voting and actions, preserving the group and votes",
  () =>
    story(
      ...setup,
      ...notes,
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.when(room, new StartVoting({})),
      Story.when(room, new SplitNote({ noteId: "b" })),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
      Story.when(room, new SetVote({ noteId: "b", selected: true })),
      Story.when(room, new FinishVoting({})),
      Story.when(room, new SplitNote({ noteId: "b" })),
      Story.rejected(
        new Refused({
          reason: "The session has moved on. Refresh your board and try again.",
        }),
      ),
      Story.view(SharedBoard, room, (s) => {
        expect(s?.notes).toHaveLength(1);
        expect(s?.scores.reduce((sum, x) => sum + x.count, 0)).toBe(1);
      }),
    ),
);

it.effect(
  "accepts fewer votes as done and keeps other participants' completion intact",
  () =>
    story(
      ...setup,
      ...notes,
      Story.when(room, new StartVoting({})),
      Story.when(room, new SetVote({ noteId: "a", selected: true })),
      Story.when(room, new SetVotingDone({ done: true })),
      Story.view(SharedBoard, room, (s) => expect(s?.voters).toContain("host")),
      Story.provide(CurrentActor, { id: "guest" }),
      Story.when(room, new SetVote({ noteId: "b", selected: true })),
      Story.view(SharedBoard, room, (s) => expect(s?.voters).toContain("host")),
      Story.provide(CurrentActor, { id: "host" }),
      Story.when(room, new SetVotingDone({ done: false })),
      Story.view(SharedBoard, room, (s) =>
        expect(s?.voters).not.toContain("host"),
      ),
    ),
);

it.effect("uses the story clock for timer pause and expiry", () =>
  story(
    ...setup,
    Story.provide(CurrentActor, { id: "host" }),
    Story.clock("2026-01-01T12:00:00Z"),
    Story.when(room, new SetTimer({ operation: "start", seconds: 300 })),
    Story.clock("2026-01-01T12:02:00Z"),
    Story.when(room, new SetTimer({ operation: "pause", seconds: 0 })),
    Story.view(SharedBoard, room, (s) =>
      expect(s?.timer).toEqual({ endsAt: 0, remainingMs: 180000 }),
    ),
    Story.when(room, new SetTimer({ operation: "resume", seconds: 0 })),
    Story.clock("2026-01-01T12:06:00Z"),
    Story.when(room, new SetTimer({ operation: "pause", seconds: 0 })),
    Story.view(SharedBoard, room, (s) =>
      expect(s?.timer).toEqual({ endsAt: 0, remainingMs: 0 }),
    ),
  ),
);

it.effect(
  "splits nested combinations without losing notes or their order",
  () =>
    story(
      ...setup,
      Story.provide(CurrentActor, { id: "host" }),
      ...["a", "b", "c", "d"].map((id) =>
        Story.when(room, new SaveNote({ id, column: "mad", text: id })),
      ),
      Story.when(room, new RevealNotes({})),
      Story.when(room, new CombineNotes({ sourceId: "a", targetId: "b" })),
      Story.when(room, new CombineNotes({ sourceId: "c", targetId: "d" })),
      Story.when(room, new CombineNotes({ sourceId: "b", targetId: "d" })),
      Story.when(room, new SplitNote({ noteId: "d" })),
      Story.when(room, new SplitNote({ noteId: "b" })),
      Story.when(room, new SplitNote({ noteId: "d" })),
      Story.view(SharedBoard, room, (s) =>
        expect(s?.notes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]),
      ),
    ),
);
