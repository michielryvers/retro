import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";

export class RoomCleanup extends Domain.ExternalSystem("RoomCleanup", {
  remove: { args: { id: RoomId, title: Schema.String }, success: { deleted: Schema.Boolean } },
}) {}
