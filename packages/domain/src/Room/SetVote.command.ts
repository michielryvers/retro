import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { VotingProgressChanged } from "./VotingProgressChanged.event.ts";

export class VoteRecorded extends Domain.Event("VoteRecorded", {
  participantId: Schema.String,
  noteId: Schema.String,
  selected: Schema.Boolean,
}) {}

export class SetVote extends Domain.Command("SetVote", {
  target: RoomId,
  middleware: [Session],
  input: { noteId: Schema.String, selected: Schema.Boolean },
  events: [VotingProgressChanged, VoteRecorded],
  rejects: [Refused],
}) {}
