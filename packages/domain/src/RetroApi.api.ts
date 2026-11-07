import * as Domain from "@alchemy.run/domain";
import { Retro } from "./Retro.model.ts";

// Keep an explicit public surface: internal retention/deletion commands and
// the administrator's room index must never become public RPCs.
export class RetroApi extends Domain.Api("RetroApi", {
  model: Retro,
  commands: [
    "InviteParticipant", "SetTimer", "Handover", "UndoCombine", "SplitNote",
    "CombineNotes", "CreateRoom", "JoinRoom", "SaveNote", "DeleteNote",
    "SetReady", "RevealNotes", "StartVoting", "SetVoteLimit", "SetVote", "SetVotingDone",
    "FinishVoting", "SaveAction", "DeleteAction", "CloseRoom", "ArchiveRoom",
  ],
  views: ["Invitations", "SharedBoard", "MyNotes"],
  streams: [],
  aggregates: [],
}) {}
