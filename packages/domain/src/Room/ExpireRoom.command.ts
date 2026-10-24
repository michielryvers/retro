import * as Domain from "@alchemy.run/domain";
import { RoomId } from "./Room.id.ts";
import { RoomClosed } from "./CloseRoom.command.ts";

// Internal scheduled command: never exposed through RetroApi.
export class ExpireRoom extends Domain.Command("ExpireRoom", {
  target: RoomId,
  input: {},
  events: [RoomClosed],
}) {}
