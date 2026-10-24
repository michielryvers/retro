import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { Invitation } from "./Access.ts";

export class ParticipantInvited extends Domain.Event(
  "ParticipantInvited",
  Invitation.fields,
) {}

export class InviteParticipant extends Domain.Command("InviteParticipant", {
  target: RoomId,
  middleware: [Session],
  input: { name: Schema.String },
  events: [ParticipantInvited],
  rejects: [Refused],
}) {}
