import { DeleteAction } from "./Room/DeleteAction.command.ts";
import { Invitations } from "./Room/Invitations.view.ts";
import { InviteParticipant } from "./Room/InviteParticipant.command.ts";
import { SetTimer } from "./Room/SetTimer.command.ts";
import { Handover } from "./Room/Handover.command.ts";
import { UndoCombine } from "./Room/UndoCombine.command.ts";
import { SplitNote } from "./Room/SplitNote.command.ts";
import { ArchiveRoom } from "./Room/ArchiveRoom.command.ts";
import { CombineNotes } from "./Room/CombineNotes.command.ts";
import * as Domain from "@alchemy.run/domain";
import { CreateRoom } from "./Room/CreateRoom.command.ts";
import { JoinRoom } from "./Room/JoinRoom.command.ts";
import { SaveNote } from "./Room/SaveNote.command.ts";

import { DeleteNote } from "./Room/DeleteNote.command.ts";
import { SetReady } from "./Room/SetReady.command.ts";
import { RevealNotes } from "./Room/RevealNotes.command.ts";
import { StartVoting } from "./Room/StartVoting.command.ts";
import { SetVote } from "./Room/SetVote.command.ts";
import { SetVotingDone } from "./Room/SetVotingDone.command.ts";
import { FinishVoting } from "./Room/FinishVoting.command.ts";
import { SaveAction } from "./Room/SaveAction.command.ts";
import { CloseRoom } from "./Room/CloseRoom.command.ts";
import { SharedBoard } from "./Room/SharedBoard.view.ts";
import { MyNotes } from "./Room/MyNotes.view.ts";

export class RetroApi extends Domain.Api(
  "RetroApi",
  InviteParticipant,
  Invitations,
  SetTimer,
  Handover,
  UndoCombine,
  SplitNote,
  CombineNotes,
  CreateRoom,
  JoinRoom,
  SaveNote,
  DeleteNote,
  SetReady,
  RevealNotes,
  StartVoting,
  SetVote,
  SetVotingDone,
  FinishVoting,
  SaveAction,
  DeleteAction,
  CloseRoom,
  ArchiveRoom,
  SharedBoard,
  MyNotes,
) {}
