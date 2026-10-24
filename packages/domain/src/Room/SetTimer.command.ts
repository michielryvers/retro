import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { TimerState } from "./Values.ts";

export class TimerChanged extends Domain.Event("TimerChanged", {
  timer: TimerState,
}) {}

export class SetTimer extends Domain.Command("SetTimer", {
  target: RoomId,
  middleware: [Session],
  rejects: [Refused],
  events: [TimerChanged],
  input: {
    operation: Schema.Literals(["start", "pause", "resume", "extend", "stop"]),
    seconds: Schema.Int,
  },
}) {}
