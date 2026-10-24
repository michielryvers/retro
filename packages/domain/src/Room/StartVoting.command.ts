import * as Domain from "@alchemy.run/domain";
import { RoomId } from "./Room.id.ts";
import { Session } from "../Session.middleware.ts";
import { Refused } from "./Refused.rejection.ts";

export class VotingStarted extends Domain.Event("VotingStarted", {}) {}

export class StartVoting extends Domain.Command("StartVoting", {
  target: RoomId,
  middleware: [Session],
  input: {},
  events: [VotingStarted],
  rejects: [Refused],
}) {}
