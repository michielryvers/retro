import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class VoteLimitChanged extends Domain.Event("VoteLimitChanged", {
  limit: Schema.Int,
}) {}

export class SetVoteLimit extends Domain.Command("SetVoteLimit", {
  target: RoomId,
  middleware: [Session],
  input: { limit: Schema.Int },
  events: [VoteLimitChanged],
  rejects: [Refused],
}) {}
