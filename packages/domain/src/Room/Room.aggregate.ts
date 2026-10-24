import { columnsFor, tallyNotes } from "./Templates.ts";
import { ExpireRoom } from "./ExpireRoom.command.ts";
import { RequestRoomDeletion, RoomDeletionRequested } from "./RequestRoomDeletion.command.ts";
import { RETENTION_WEEK_MS } from "./Retention.ts";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import { PreparedAccess } from "../PreparedAccess.context.ts";
import { DeleteAction, ActionDeleted } from "./DeleteAction.command.ts";
import * as DateTime from "effect/DateTime";
import {
  InviteParticipant,
  ParticipantInvited,
} from "./InviteParticipant.command.ts";
import {
  SessionGranted,
  JoinAttempted,
  JoinRoom,
  ParticipantJoined,
} from "./JoinRoom.command.ts";
import { grantParticipant, sameSecret } from "./Access.ts";
import { SetTimer, TimerChanged } from "./SetTimer.command.ts";
import { Handover, FacilitatorChanged } from "./Handover.command.ts";
import { UndoCombine } from "./UndoCombine.command.ts";
import { SplitNote } from "./SplitNote.command.ts";

import { NotesUncombined } from "./NotesUncombined.event.ts";
import { Combination, combinedNotes } from "./Combination.ts";

import { ArchiveRoom, RoomArchived } from "./ArchiveRoom.command.ts";
import {
  CombineNotes,
  NotesCombined,
} from "./CombineNotes.command.ts";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { CurrentActor } from "../CurrentActor.context.ts";
import { RoomId } from "./Room.id.ts";
import { Refused } from "./Refused.rejection.ts";
import { RoomState, initialRoom } from "./RoomState.ts";
import { CreateRoom, RoomCreated } from "./CreateRoom.command.ts";

import { SaveNote, NoteSaved } from "./SaveNote.command.ts";
import { TallyChanged } from "./TallyChanged.event.ts";
import { DeleteNote, NoteDeleted } from "./DeleteNote.command.ts";
import { SetReady, ReadinessChanged } from "./SetReady.command.ts";
import { RevealNotes, NotesRevealed } from "./RevealNotes.command.ts";
import { StartVoting, VotingStarted } from "./StartVoting.command.ts";
import { SetVote, VoteRecorded } from "./SetVote.command.ts";
import { SetVotingDone } from "./SetVotingDone.command.ts";
import { VotingProgressChanged } from "./VotingProgressChanged.event.ts";
import { FinishVoting, VotingFinished } from "./FinishVoting.command.ts";
import { SaveAction, ActionAssigned } from "./SaveAction.command.ts";
import { CloseRoom, RoomClosed } from "./CloseRoom.command.ts";

type State = typeof RoomState.Type;

const refuse = (reason: string) => new Refused({ reason });

const member = Effect.fn(function* (s: State) {
  const actor = yield* CurrentActor;

  if (s.lifecycle === "uncreated")
    return yield* refuse("This room does not exist. Check the invite link.");

  const participantId = grantParticipant(s.grants, actor.id);

  if (!s.participants.some((p) => p.id === participantId))
    return yield* refuse("Join this room first.");

  return participantId!;
});

const phase = Effect.fn(function* (
  s: State,
  allowed: ReadonlyArray<State["phase"]>,
  admin = false,
) {
  const id = yield* member(s);

  if (admin && id !== s.adminId)
    return yield* refuse("Only the facilitator can do that.");

  if (!allowed.includes(s.phase))
    return yield* refuse(
      "The session has moved on. Refresh your board and try again.",
    );

  return id;
});

const validText = (s: string, max: number) =>
  s.trim().length > 0 && s.trim().length <= max;

// Reserve at least 200 KB below the documented 2 MB key + value ceiling.
// The public board expands grouped notes, so guard that representation too.
export const ROOM_STATE_LIMIT = 1_800_000;
const roomNotes = (s: State) => combinedNotes(s.notes, s.combinations);

const storedBytes = (s: State) => Math.max(
  new TextEncoder().encode(JSON.stringify(s)).byteLength,
  new TextEncoder().encode(JSON.stringify({ ...s, notes: roomNotes(s) })).byteLength,
);

const capacity = Effect.fn(function* (before: State, after: State) {
  const bytes = storedBytes(after);

  if (bytes > ROOM_STATE_LIMIT && bytes > storedBytes(before))
    return yield* refuse(
      "This room is full. Shorten or remove some content before adding more.",
    );
});


const applyCombination = (s: State, e: NotesCombined): State => ({
  ...s,
  combinations: [...s.combinations, { sourceId: e.sourceId, targetId: e.targetId }],
});

const uncombine = (s: State, combination: typeof Combination.Type) => {
  const remaining = s.combinations.filter(
    (_, i) => i !== s.combinations.lastIndexOf(combination),
  );

  const notes = combinedNotes(s.notes, remaining);

  return new NotesUncombined({
    source: notes.find((n) => n.id === combination.sourceId)!,
    target: notes.find((n) => n.id === combination.targetId)!,
    order: s.notes.map((n) => n.id),
    canUndoCombine:
      remaining.length > 0 &&
      notes.some((n) => n.id === remaining.at(-1)!.targetId),
  });
};

export class Room extends Domain.Aggregate("RetroRoom", {
  id: RoomId,
  state: RoomState,
  initial: initialRoom,
  commands: [
    InviteParticipant,
    SetTimer,
    Handover,
    UndoCombine,
    SplitNote,
    CombineNotes,
    CreateRoom,
    JoinRoom,
    SaveNote,
    DeleteNote,
    SetReady,
    RevealNotes,
    StartVoting,
    SetVote,
    SetVotingDone,
    FinishVoting,
    SaveAction,
    DeleteAction,
    CloseRoom,
    ExpireRoom,
    RequestRoomDeletion,
    ArchiveRoom,
  ],
  decide: {
    InviteParticipant: Effect.fn(function* (s, c) {
      yield* phase(s, ["write", "reveal", "vote", "actions"], true);

      if (!validText(c.name, 40))
        return yield* refuse("Use a name between 1 and 40 characters.");

      if (s.invitations.length >= 30)
        return yield* refuse("This room has reached its 30-person limit.");

      return [
        new ParticipantInvited({
          id: (yield* PreparedAccess).id,
          name: c.name.trim(),
        }),
      ];
    }),
    ArchiveRoom: Effect.fn(function* (s, c) {
      yield* phase(s, ["closed"], true);

      return [new RoomArchived({ archived: c.archived })];
    }),
    SetTimer: Effect.fn(function* (s, c, context) {
      yield* phase(s, ["write", "reveal", "vote", "actions"], true);

      if (c.seconds < 0 || c.seconds > 3600)
        return yield* refuse("Choose a timer of up to one hour.");
      const now = DateTime.toEpochMillis(context.now);

      const remaining = s.timer?.endsAt
        ? Math.max(0, s.timer.endsAt - now)
        : (s.timer?.remainingMs ?? 0);

      const duration = c.seconds * 1000;
      let timer = { endsAt: 0, remainingMs: 0 };

      switch (c.operation) {
        case "start":
          timer = { endsAt: now + duration, remainingMs: duration };
          break;
        case "pause":
          timer = { endsAt: 0, remainingMs: remaining };
          break;
        case "resume":
          timer = {
            endsAt: remaining ? now + remaining : 0,
            remainingMs: remaining,
          };
          break;
        case "extend": {
          const next = Math.min(3600000, remaining + duration);
          timer = {
            endsAt: s.timer?.endsAt ? now + next : 0,
            remainingMs: next,
          };
          break;
        }

        case "stop":
          break;
      }

      return [new TimerChanged({ timer })];
    }),
    Handover: Effect.fn(function* (s, c) {
      const actor = yield* member(s);

      if (actor !== s.adminId)
        return yield* refuse("Only the facilitator can hand over this room.");

      if (
        c.participantId === actor ||
        !s.participants.some((p) => p.id === c.participantId)
      )
        return yield* refuse("Choose another participant in this room.");

      return [new FacilitatorChanged({ adminId: c.participantId })];
    }),
    SplitNote: Effect.fn(function* (s, c) {
      yield* phase(s, ["reveal"], true);
      const note = roomNotes(s).find((n) => n.id === c.noteId);

      if (!note?.parts || note.parts.length < 2)
        return yield* refuse("Choose a combined note to split.");

      const combination = s.combinations.findLast(
        (x) => x.targetId === c.noteId,
      );

      if (!combination)
        return yield* refuse("Choose a combined note to split.");

      return [uncombine(s, combination)];
    }),
    UndoCombine: Effect.fn(function* (s) {
      yield* phase(s, ["reveal"], true);
      const combination = s.combinations.at(-1);

      if (!combination || !roomNotes(s).some((n) => n.id === combination.targetId))
        return yield* refuse("There is no combination to undo.");

      return [uncombine(s, combination)];
    }),
    CombineNotes: Effect.fn(function* (s, c) {
      yield* phase(s, ["reveal"], true);

      if (c.sourceId === c.targetId)
        return yield* refuse("Choose two different notes to combine.");
      const source = roomNotes(s).find((n) => n.id === c.sourceId);
      const target = roomNotes(s).find((n) => n.id === c.targetId);

      if (!source || !target)
        return yield* refuse(
          "One of these notes has already been combined. Choose the notes again.",
        );

      const parts = [
        ...(target.parts ?? [target]),
        ...(source.parts ?? [source]),
      ].map(({ id, column, text, authorId }) => ({
        id,
        column,
        text,
        authorId,
      }));

      const combined = new NotesCombined({
        sourceId: source.id,
        targetId: target.id,
        note: {
          ...target,
          parts,
          text: parts.map((n) => n.text).join("\n\n—\n\n"),
        },
      });

      yield* capacity(s, applyCombination(s, combined));

      return [combined];
    }),
    CreateRoom: Effect.fn(function* (s, c) {
      const a = yield* CurrentActor;

      if (s.lifecycle === "created")
        return yield* refuse("This room already exists.");

      if (!validText(c.title, 100) || !validText(c.name, 40))
        return yield* refuse(
          "Add a room title (up to 100 characters) and your name (up to 40).",
        );

      if (
        Redacted.value(c.password).length < 3 ||
        Redacted.value(c.password).length > 128
      )
        return yield* refuse(
          "Use a room password between 3 and 128 characters.",
        );
      const prepared = yield* PreparedAccess;

      return [
        new RoomCreated({
          title: c.title.trim(),
          template: c.template,
          adminId: prepared.id,
          sessionId: a.id,
          inviteSeed: prepared.seed,
          passwordSalt: prepared.salt,
          passwordHash: prepared.hash,
          name: c.name.trim(),
        }),
      ];
    }),
    JoinRoom: Effect.fn(function* (s, c, context) {
      const a = yield* CurrentActor;
      const person = s.invitations.find((p) => p.id === c.participantId);
      const denied = () => refuse("The invitation or password is incorrect.");

      if (
        !person ||
        Redacted.value(c.token).length !== 64 ||
        Redacted.value(c.password).length > 128
      )
        return yield* denied();

      const prepared = yield* PreparedAccess;

      if (
        !prepared.validToken ||
        !sameSecret(Redacted.value(prepared.seed), Redacted.value(s.inviteSeed))
      )
        return yield* denied();
      const now = DateTime.toEpochMillis(context.now);

      const previous = s.attempts.find(
        (v) =>
          v.participantId === person.id && now - v.windowStart < 15 * 60 * 1000,
      );

      if (previous && previous.count >= 5)
        return yield* refuse("Too many attempts. Try again in 15 minutes.");

      if (
        !sameSecret(
          Redacted.value(prepared.hash),
          Redacted.value(s.passwordHash),
        )
      )
        return [
          new JoinAttempted({
            participantId: person.id,
            count: (previous?.count ?? 0) + 1,
            windowStart: previous?.windowStart ?? now,
          }),
        ];
      const bound = grantParticipant(s.grants, a.id);

      if (bound && bound !== person.id)
        return yield* refuse(
          "This browser is already signed in as someone else in this room. Open this invite in a separate browser profile.",
        );

      if (bound) return [];

      if (s.grants.length >= 300)
        return yield* refuse("This room has reached its device limit.");

      return [
        ...(!s.participants.some((p) => p.id === person.id)
          ? [new ParticipantJoined({ id: person.id, name: person.name })]
          : []),
        new SessionGranted({ participantId: person.id, sessionId: a.id }),
      ];
    }),
    SaveNote: Effect.fn(function* (s, c) {
      const id = yield* phase(s, ["write"]);

      if (!columnsFor(s.template).some((column) => column.id === c.column))
        return yield* refuse("Choose a column in this room’s format.");
      const old = s.notes.find((n) => n.id === c.id);

      if (old && old.authorId !== id)
        return yield* refuse("You can only edit your own notes.");

      if (!validText(c.id, 80) || !validText(c.text, 2000))
        return yield* refuse("Write a note between 1 and 2,000 characters.");

      if (!old && s.notes.length >= 300)
        return yield* refuse("This room has reached its 300-note limit.");

      const note = {
        id: c.id,
        column: c.column,
        text: c.text.trim(),
        authorId: id,
      };

      const notes = [...s.notes.filter((n) => n.id !== c.id), note];

      yield* capacity(s, { ...s, notes });

      return [
        new TallyChanged({ tally: tallyNotes(s.template, notes) }),
        new NoteSaved({ note }),
      ];
    }),
    DeleteNote: Effect.fn(function* (s, c) {
      const id = yield* phase(s, ["write"]);
      const n = s.notes.find((n) => n.id === c.id);

      if (!n) return [];

      if (n.authorId !== id)
        return yield* refuse("You can only delete your own notes.");

      return [
        new TallyChanged({
          tally: tallyNotes(s.template, s.notes.filter((n) => n.id !== c.id)),
        }),
        new NoteDeleted({ id: c.id, authorId: id }),
      ];
    }),
    SetReady: Effect.fn(function* (s, c) {
      const id = yield* phase(s, ["write"]);

      return [new ReadinessChanged({ id, ready: c.ready })];
    }),
    RevealNotes: Effect.fn(function* (s) {
      yield* phase(s, ["write"], true);

      return [new NotesRevealed({ notes: s.notes })];
    }),
    StartVoting: Effect.fn(function* (s) {
      yield* phase(s, ["reveal"], true);

      return [new VotingStarted({})];
    }),
    SetVotingDone: Effect.fn(function* (s, c) {
      const id = yield* phase(s, ["vote"]);

      return [
        new VotingProgressChanged({
          voters: [
            ...s.voters.filter((p) => p !== id),
            ...(c.done ? [id] : []),
          ],
        }),
      ];
    }),
    SetVote: Effect.fn(function* (s, c) {
      const id = yield* phase(s, ["vote"]);

      if (!roomNotes(s).some((n) => n.id === c.noteId))
        return yield* refuse("That note no longer exists.");
      const mine = s.votes.filter((v) => v.participantId === id);

      if (mine.some((v) => v.noteId === c.noteId) === c.selected) return [];

      if (c.selected && mine.length >= s.voteLimit)
        return yield* refuse(
          `You have used all ${s.voteLimit} votes. Remove one to vote here.`,
        );

      const votes = s.votes.filter(
        (v) => !(v.participantId === id && v.noteId === c.noteId),
      );

      if (c.selected) votes.push({ participantId: id, noteId: c.noteId });
      const available = Math.min(s.voteLimit, roomNotes(s).length);

      const voters = s.voters.filter((p) => p !== id);

      if (votes.filter((v) => v.participantId === id).length >= available)
        voters.push(id);

      return [
        new VotingProgressChanged({ voters }),
        new VoteRecorded({
          participantId: id,
          noteId: c.noteId,
          selected: c.selected,
        }),
      ];
    }),
    FinishVoting: Effect.fn(function* (s) {
      yield* phase(s, ["vote"], true);

      return [
        new VotingFinished({
          scores: roomNotes(s).map((n) => ({
            noteId: n.id,
            count: s.votes.filter((v) => v.noteId === n.id).length,
          })),
        }),
      ];
    }),
    SaveAction: Effect.fn(function* (s, c) {
      yield* phase(s, ["actions"], true);

      if (!roomNotes(s).some((n) => n.id === c.noteId))
        return yield* refuse("Choose the note this action addresses.");

      if (!validText(c.text, 500) || !validText(c.id, 80))
        return yield* refuse("Describe the action in 1–500 characters.");

      if (c.ownerId && !s.participants.some((p) => p.id === c.ownerId))
        return yield* refuse("Choose someone in this room.");

      if (c.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate))
        return yield* refuse("Choose a valid due date.");

      if (!s.actions.some((a) => a.id === c.id) && s.actions.length >= 100)
        return yield* refuse("This room has reached its action limit.");

      const action = {
        ...c,
        text: c.text.trim(),
      };

      yield* capacity(s, {
        ...s,
        actions: [...s.actions.filter((a) => a.id !== c.id), action],
      });

      return [new ActionAssigned({ action })];
    }),
    DeleteAction: Effect.fn(function* (s, c) {
      yield* phase(s, ["actions"], true);

      if (!s.actions.some((a) => a.id === c.id))
        return yield* refuse("This action no longer exists.");

      return [new ActionDeleted({ id: c.id })];
    }),
    ExpireRoom: (s, _c, { now }) =>
      s.lifecycle === "created" && s.phase !== "closed" &&
      DateTime.toEpochMillis(now) >= s.createdAt + RETENTION_WEEK_MS
        ? [new RoomClosed({ closedAt: s.createdAt + RETENTION_WEEK_MS })]
        : [],
    RequestRoomDeletion: (s, _c, { now }) =>
      s.phase === "closed" && DateTime.toEpochMillis(now) >= s.closedAt + RETENTION_WEEK_MS
        ? [new RoomDeletionRequested({ title: s.title })]
        : [],
    CloseRoom: Effect.fn(function* (s, _c, { now }) {
      yield* phase(s, ["actions"], true);

      return [new RoomClosed({ closedAt: DateTime.toEpochMillis(now) })];
    }),
  },
  reply: {
    JoinRoom: (_s, events) => ({
      joined: !events.some((e) => Predicate.isTagged(e, "JoinAttempted")),
    }),
  },
  evolve: {
    ParticipantInvited: (s, e) => ({
      ...s,
      invitations: [...s.invitations, { id: e.id, name: e.name }],
    }),
    SessionGranted: (s, e) => ({
      ...s,
      grants: [
        ...s.grants,
        { participantId: e.participantId, sessionId: e.sessionId },
      ],
      attempts: s.attempts.filter((a) => a.participantId !== e.participantId),
    }),
    JoinAttempted: (s, e) => ({
      ...s,
      attempts: [
        ...s.attempts.filter((a) => a.participantId !== e.participantId),
        {
          participantId: e.participantId,
          count: e.count,
          windowStart: e.windowStart,
        },
      ],
    }),
    TimerChanged: (s, e) => ({ ...s, timer: e.timer }),
    FacilitatorChanged: (s, e) => ({
      ...s,
      adminId: e.adminId,
    }),
    NotesUncombined: (s, e) => ({
      ...s,
      combinations: s.combinations.filter(
        (_, index) =>
          index !==
          s.combinations.findLastIndex(
            (c) => c.targetId === e.target.id,
          ),
      ),
    }),
    RoomArchived: (s, e) => ({ ...s, archived: e.archived }),
    NotesCombined: applyCombination,
    RoomCreated: (s, e, { at }) => ({
      ...s,
      createdAt: DateTime.toEpochMillis(at),
      lifecycle: "created" as const,
      invitations: [{ id: e.adminId, name: e.name }],
      grants: [{ participantId: e.adminId, sessionId: e.sessionId }],
      inviteSeed: e.inviteSeed,
      passwordSalt: e.passwordSalt,
      passwordHash: e.passwordHash,
      title: e.title,
      template: e.template,
      adminId: e.adminId,
      participants: [{ id: e.adminId, name: e.name, ready: false }],
    }),
    ParticipantJoined: (s, e) => ({
      ...s,
      participants: [
        ...s.participants,
        { id: e.id, name: e.name, ready: false },
      ],
    }),
    NoteSaved: (s, e) => ({
      ...s,
      notes: [...s.notes.filter((n) => n.id !== e.note.id), e.note],
      participants: s.participants.map((p) =>
        p.id === e.note.authorId ? { ...p, ready: false } : p,
      ),
    }),
    TallyChanged: (s) => s,
    NoteDeleted: (s, e) => ({
      ...s,
      notes: s.notes.filter((n) => n.id !== e.id),
    }),
    ReadinessChanged: (s, e) => ({
      ...s,
      participants: s.participants.map((p) =>
        p.id === e.id ? { ...p, ready: e.ready } : p,
      ),
    }),
    NotesRevealed: (s) => ({
      ...s,
      phase: "reveal" as const,
      timer: { endsAt: 0, remainingMs: 0 },
    }),
    VotingStarted: (s) => ({
      ...s,
      phase: "vote" as const,
      timer: { endsAt: 0, remainingMs: 0 },
    }),
    VotingProgressChanged: (s, e) => ({ ...s, voters: e.voters }),
    VoteRecorded: (s, e) => ({
      ...s,
      votes: [
        ...s.votes.filter(
          (v) =>
            !(v.participantId === e.participantId && v.noteId === e.noteId),
        ),
        ...(e.selected
          ? [{ participantId: e.participantId, noteId: e.noteId }]
          : []),
      ],
    }),
    VotingFinished: (s) => ({
      ...s,
      phase: "actions" as const,
      timer: { endsAt: 0, remainingMs: 0 },
    }),
    ActionAssigned: (s, e) => ({
      ...s,
      actions: [...s.actions.filter((a) => a.id !== e.action.id), e.action],
    }),
    ActionDeleted: (s, e) => ({
      ...s,
      actions: s.actions.filter((a) => a.id !== e.id),
    }),
    RoomDeletionRequested: (s) => s,
    RoomClosed: (s, e) => ({
      ...s,
      closedAt: e.closedAt,
      phase: "closed" as const,
      timer: { endsAt: 0, remainingMs: 0 },
    }),
  },
}) {}
