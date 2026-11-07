import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { ParticipantInvited } from "./InviteParticipant.command.ts";
import { ParticipantJoined, SessionGranted, JoinAttempted } from "./JoinRoom.command.ts";

export class JoinSharedRoom extends Domain.Command("JoinSharedRoom", {
  target: RoomId,
  middleware: [Session],
  input: {
    name: Schema.String,
    token: Schema.Redacted(Schema.String),
    password: Schema.Redacted(Schema.String),
  },
  reply: { joined: Schema.Boolean },
  events: [ParticipantInvited, ParticipantJoined, SessionGranted, JoinAttempted],
  rejects: [Refused],
}) {}
