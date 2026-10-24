import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class FacilitatorChanged extends Domain.Event("FacilitatorChanged", {
  adminId: Schema.String,
}) {}

export class Handover extends Domain.Command("Handover", {
  target: RoomId,
  middleware: [Session],
  rejects: [Refused],
  events: [FacilitatorChanged],
  input: { participantId: Schema.String },
}) {}
