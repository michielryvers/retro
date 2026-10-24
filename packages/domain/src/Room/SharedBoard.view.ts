import { tallyNotes } from "./Templates.ts";
import { grantParticipant } from "./Access.ts";
import { restoreCombination } from "./Combination.ts";
import { combineBoard } from "./CombineNotes.command.ts";
import * as Domain from "@alchemy.run/domain";
import { RETENTION_WEEK_MS } from "./Retention.ts";
import * as Effect from "effect/Effect";
import { Room } from "./Room.aggregate.ts";
import { BoardState, emptyBoard } from "./Values.ts";
import { Session } from "../Session.middleware.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { Refused } from "./Refused.rejection.ts";

const withNotes = (
  s: typeof BoardState.Type,
  notes: (typeof BoardState.Type)["notes"],
  canUndoCombine: boolean,
) => ({
  ...s,
  notes,
  canUndoCombine,
  tally: tallyNotes(s.template, notes),
});

// State subscriptions publish snapshots without retaining a full-board event history.
export class SharedBoard extends Domain.View("SharedBoard", {
  from: [Room],
  key: Room,
  state: BoardState,
  initial: emptyBoard,
  middleware: [Session],
  rejects: [Refused],
  events: [],
  validate: Effect.fn(function* (_request, s) {
    const a = yield* CurrentActor;

    if (!s?.participants.some((p) => p.id === grantParticipant(s.grants, a.id)))
      return yield* new Refused({ reason: "Join this room to see its board." });
  }),
  evolve: {
    SessionGranted: (s, e) => ({
      ...s,
      grants: [
        ...s.grants,
        { participantId: e.participantId, sessionId: e.sessionId },
      ],
    }),
    TimerChanged: (s, e) => ({ ...s, timer: e.timer }),
    FacilitatorChanged: (s, e) => ({ ...s, adminId: e.adminId }),
    NotesUncombined: (s, e) =>
      withNotes(
        s,
        restoreCombination(s.notes, e, e.order),
        e.canUndoCombine,
      ),
    RoomArchived: (s, e) => ({ ...s, archived: e.archived }),
    NotesCombined: (s, e) => withNotes(s, combineBoard(s.notes, e), true),
    RoomCreated: (s, e) => ({
      ...s,
      grants: [{ participantId: e.adminId, sessionId: e.sessionId }],
      title: e.title,
      template: e.template,
      tally: tallyNotes(e.template, []),
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
    TallyChanged: (s, e) => ({ ...s, tally: e.tally }),
    NoteSaved: (s, e) => ({
      ...s,
      participants: s.participants.map((p) =>
        p.id === e.note.authorId ? { ...p, ready: false } : p,
      ),
    }),
    ReadinessChanged: (s, e) => ({
      ...s,
      participants: s.participants.map((p) =>
        p.id === e.id ? { ...p, ready: e.ready } : p,
      ),
    }),
    NotesRevealed: (s, e) => ({
      ...s,
      phase: "reveal" as const,
      timer: { endsAt: 0, remainingMs: 0 },
      notes: e.notes,
    }),
    VotingStarted: (s) => ({
      ...s,
      phase: "vote" as const,
      canUndoCombine: false,
      timer: { endsAt: 0, remainingMs: 0 },
    }),
    VotingProgressChanged: (s, e) => ({ ...s, voters: e.voters }),
    VotingFinished: (s, e) => ({
      ...s,
      phase: "actions" as const,
      timer: { endsAt: 0, remainingMs: 0 },
      scores: e.scores,
    }),
    ActionAssigned: (s, e) => ({
      ...s,
      actions: [...s.actions.filter((a) => a.id !== e.action.id), e.action],
    }),
    ActionDeleted: (s, e) => ({
      ...s,
      actions: s.actions.filter((a) => a.id !== e.id),
    }),
    RoomClosed: (s, e) => ({
      ...s,
      deletesAt: e.closedAt + RETENTION_WEEK_MS,
      phase: "closed" as const,
      timer: { endsAt: 0, remainingMs: 0 },
    }),
  },
  emit: {
    RetroRoom: () => undefined,
  },
}) {}
