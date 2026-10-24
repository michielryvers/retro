import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class ReadinessChanged extends Domain.Event("ReadinessChanged", {
  id: Schema.String,
  ready: Schema.Boolean,
}) {}

export class SetReady extends Domain.Command("SetReady", {
  target: RoomId,
  middleware: [Session],
  input: { ready: Schema.Boolean },
  events: [ReadinessChanged],
  rejects: [Refused],
}) {}
