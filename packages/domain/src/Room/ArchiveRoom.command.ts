import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class RoomArchived extends Domain.Event("RoomArchived", {
  archived: Schema.Boolean,
}) {}

export class ArchiveRoom extends Domain.Command("ArchiveRoom", {
  target: RoomId,
  middleware: [Session],
  input: { archived: Schema.Boolean },
  events: [RoomArchived],
  rejects: [Refused],
}) {}
