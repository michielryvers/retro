import * as Schema from "effect/Schema";
import * as Domain from "@alchemy.run/domain";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class RoomClosed extends Domain.Event("RoomClosed", { closedAt: Schema.Number }) {}

export class CloseRoom extends Domain.Command("CloseRoom", {
  target: RoomId,
  middleware: [Session],
  input: {},
  events: [RoomClosed],
  rejects: [Refused],
}) {}
