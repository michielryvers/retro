import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";

export class RoomDeletionRequested extends Domain.Event("RoomDeletionRequested", {
  title: Schema.String,
}) {}

// Internal scheduled command; the physical purge belongs to the server adapter.
export class RequestRoomDeletion extends Domain.Command("RequestRoomDeletion", {
  target: RoomId,
  input: {},
  events: [RoomDeletionRequested],
}) {}
