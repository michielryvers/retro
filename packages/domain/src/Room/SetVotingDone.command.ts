import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";
import { VotingProgressChanged } from "./VotingProgressChanged.event.ts";

export class SetVotingDone extends Domain.Command("SetVotingDone", {
  target: RoomId,
  middleware: [Session],
  input: { done: Schema.Boolean },
  events: [VotingProgressChanged],
  rejects: [Refused],
}) {}
