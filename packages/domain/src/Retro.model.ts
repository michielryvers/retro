import { RoomRetention } from "./Room/RoomRetention.policy.ts";
import { RoomSummary } from "./Room/RoomSummary.view.ts";
import { Invitations } from "./Room/Invitations.view.ts";
import * as Domain from "@alchemy.run/domain";
import { Room } from "./Room/Room.aggregate.ts";
import { SharedBoard } from "./Room/SharedBoard.view.ts";
import { MyNotes } from "./Room/MyNotes.view.ts";

export class Retro extends Domain.Model("CommonGround", {
  aggregates: [Room],
  policies: [RoomRetention],
  views: [SharedBoard, MyNotes, Invitations, RoomSummary],
}) {}
