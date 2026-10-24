import { Grant } from "./Access.ts";
import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class SessionGranted extends Domain.Event(
  "SessionGranted",
  Grant.fields,
) {}

export class JoinAttempted extends Domain.Event("JoinAttempted", {
  participantId: Schema.String,
  count: Schema.Int,
  windowStart: Schema.Number,
}) {}

export class ParticipantJoined extends Domain.Event("ParticipantJoined", {
  id: Schema.String,
  name: Schema.String,
}) {}

export class JoinRoom extends Domain.Command("JoinRoom", {
  target: RoomId,
  middleware: [Session],
  input: {
    participantId: Schema.String,
    token: Schema.Redacted(Schema.String),
    password: Schema.Redacted(Schema.String),
  },
  reply: { joined: Schema.Boolean },
  events: [ParticipantJoined, SessionGranted, JoinAttempted],
  rejects: [Refused],
}) {}
