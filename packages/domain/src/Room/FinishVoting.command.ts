import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Score } from "./Values.ts";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class VotingFinished extends Domain.Event("VotingFinished", {
  scores: Schema.Array(Score),
}) {}

export class FinishVoting extends Domain.Command("FinishVoting", {
  target: RoomId,
  middleware: [Session],
  input: {},
  events: [VotingFinished],
  rejects: [Refused],
}) {}
