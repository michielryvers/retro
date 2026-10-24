import { Grant } from "./Access.ts";
import * as Schema from "effect/Schema";
import { Template } from "./Templates.ts";

export const Column = Schema.String;

export const Phase = Schema.Literals([
  "write",
  "reveal",
  "vote",
  "actions",
  "closed",
]);

export const Participant = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  ready: Schema.Boolean,
});

export const NotePart = Schema.Struct({
  id: Schema.String,
  column: Column,
  text: Schema.String,
  authorId: Schema.String,
});

export const Note = Schema.Struct({
  ...NotePart.fields,
  parts: Schema.optionalKey(Schema.Array(NotePart)),
});

export const Vote = Schema.Struct({
  participantId: Schema.String,
  noteId: Schema.String,
});

export const Action = Schema.Struct({
  id: Schema.String,
  noteId: Schema.String,
  text: Schema.String,
  ownerId: Schema.String,
  dueDate: Schema.String,
});

export const Tally = Schema.Record(Schema.String, Schema.Int);

export const Score = Schema.Struct({
  noteId: Schema.String,
  count: Schema.Int,
});

export const TimerState = Schema.Struct({
  endsAt: Schema.Number,
  remainingMs: Schema.Number,
});

export const BoardState = Schema.Struct({
  grants: Schema.Array(Grant),
  timer: TimerState,
  canUndoCombine: Schema.Boolean,
  deletesAt: Schema.Number,
  title: Schema.String,
  template: Template,
  adminId: Schema.String,
  phase: Phase,
  archived: Schema.Boolean,
  participants: Schema.Array(Participant),
  notes: Schema.Array(Note),
  tally: Tally,
  scores: Schema.Array(Score),
  voters: Schema.Array(Schema.String),
  actions: Schema.Array(Action),
  voteLimit: Schema.Int,
});

export type BoardState = typeof BoardState.Type;

export const emptyBoard: BoardState = {
  grants: [],
  timer: { endsAt: 0, remainingMs: 0 },
  canUndoCombine: false,
  deletesAt: 0,
  template: "mad-sad-glad",
  archived: false,
  title: "",
  adminId: "",
  phase: "write",
  participants: [],
  notes: [],
  tally: {},
  scores: [],
  voters: [],
  actions: [],
  voteLimit: 3,
};

export const PrivateState = Schema.Struct({
  sessions: Schema.Array(Schema.String),
  notes: Schema.Array(Note),
  votes: Schema.Array(Schema.String),
});

export type PrivateState = typeof PrivateState.Type;
