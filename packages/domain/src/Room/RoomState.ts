import * as Schema from "effect/Schema";
import {
  Action,
  NotePart,
  Participant,
  Phase,
  TimerState,
  Vote,
} from "./Values.ts";
import { Grant, Invitation } from "./Access.ts";
import { Combination } from "./Combination.ts";
import { Template } from "./Templates.ts";

// Write-side state: no public tallies, scores, or view-only undo flag.
export const RoomState = Schema.Struct({
  lifecycle: Schema.Literals(["uncreated", "created"]),
  createdAt: Schema.Number,
  closedAt: Schema.Number,
  title: Schema.String,
  template: Template,
  adminId: Schema.String,
  phase: Phase,
  archived: Schema.Boolean,
  participants: Schema.Array(Participant),
  grants: Schema.Array(Grant),
  invitations: Schema.Array(Invitation),
  notes: Schema.Array(NotePart),
  actions: Schema.Array(Action),
  votes: Schema.Array(Vote),
  voters: Schema.Array(Schema.String),
  voteLimit: Schema.Int,
  timer: TimerState,
  combinations: Schema.Array(Combination),
  inviteSeed: Schema.Redacted(Schema.String),
  passwordSalt: Schema.String,
  passwordHash: Schema.Redacted(Schema.String),
  attempts: Schema.Array(
    Schema.Struct({
      participantId: Schema.String,
      count: Schema.Int,
      windowStart: Schema.Number,
    }),
  ),
});

import * as Redacted from "effect/Redacted";

export const initialRoom: typeof RoomState.Type = {
  lifecycle: "uncreated",
  createdAt: 0,
  closedAt: 0,
  title: "",
  template: "mad-sad-glad",
  adminId: "",
  phase: "write",
  archived: false,
  participants: [],
  grants: [],
  invitations: [],
  notes: [],
  actions: [],
  votes: [],
  voters: [],
  voteLimit: 3,
  timer: { endsAt: 0, remainingMs: 0 },
  combinations: [],
  inviteSeed: Redacted.make(""),
  passwordSalt: "",
  passwordHash: Redacted.make(""),
  attempts: [],
};
