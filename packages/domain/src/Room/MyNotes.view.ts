import * as Match from "effect/Match";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { Room } from "./Room.aggregate.ts";
import { PrivateState } from "./Values.ts";
import { Session } from "../Session.middleware.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { Refused } from "./Refused.rejection.ts";

export class MyNotes extends Domain.View("MyNotes", {
  from: [Room],
  key: Room,
  state: PrivateState,
  initial: { notes: [], votes: [], sessions: [] },
  middleware: [Session],
  rejects: [Refused],
  events: [],
  keyOf: {
    RetroRoom: ({ source, event }) => {
      const owner = Match.value(event).pipe(
        Match.tag("RoomCreated", (e) => e.adminId),
        Match.tag("SessionGranted", (e) => e.participantId),
        Match.tag("NoteSaved", (e) => e.note.authorId),
        Match.tag("NoteDeleted", (e) => e.authorId),
        Match.tag("VoteRecorded", (e) => e.participantId),
        Match.orElse(() => undefined),
      );

      return owner ? Room.ref(`${source.id}:${owner}`) : undefined;
    },
  },
  validate: Effect.fn(function* (_request, s) {
    const a = yield* CurrentActor;

    if (!s?.sessions.includes(a.id))
      return yield* new Refused({ reason: "These notes are private." });
  }),
  evolve: {
    RoomCreated: (s, e) => ({ ...s, sessions: [e.sessionId] }),
    SessionGranted: (s, e) => ({
      ...s,
      sessions: [...s.sessions, e.sessionId],
    }),
    NoteSaved: (s, e) => ({
      ...s,
      notes: [...s.notes.filter((n) => n.id !== e.note.id), e.note],
    }),
    NoteDeleted: (s, e) => ({
      ...s,
      notes: s.notes.filter((n) => n.id !== e.id),
    }),
    VoteRecorded: (s, e) => ({
      ...s,
      votes: [
        ...s.votes.filter((id) => id !== e.noteId),
        ...(e.selected ? [e.noteId] : []),
      ],
    }),
  },
  emit: {
    RetroRoom: () => undefined,
  },
}) {}
