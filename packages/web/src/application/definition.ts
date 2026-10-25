import { NavigationBlock } from "../features/Navigation.ts";
import { NoticeBlock } from "../features/Notice.ts";
import { SessionControlsBlock } from "../features/SessionControls.ts";
import { CombiningBlock } from "../features/Combining.ts";
import { LifecycleBlock } from "../features/Lifecycle.ts";
import { NotesBlock } from "../features/Notes.ts";
import { ActionEditorBlock } from "../features/ActionEditor.ts";
import { EntryBlock, Flags } from "../features/Entry.ts";

export { Flags } from "../features/Entry.ts";

import { TimerBlock } from "../features/Timer.ts";
import { HandoverBlock } from "../features/Handover.ts";
import { InvitationsBlock, InviteLink } from "../features/Invitations.ts";

import * as Schema from "effect/Schema";
import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { BoardState, PrivateState } from "@retro/domain/Room/Values";

export const Model = Schema.Struct({
  navigation: NavigationBlock.Model,
  actionEditor: ActionEditorBlock.Model,
  sessionControls: SessionControlsBlock.Model,
  combining: CombiningBlock.Model,
  lifecycle: LifecycleBlock.Model,
  notes: NotesBlock.Model,
  entry: EntryBlock.Model,
  invitations: InvitationsBlock.Model,
  timer: TimerBlock.Model,
  handover: HandoverBlock.Model,
  sessionId: Schema.String,
  unavailable: Schema.Boolean,
  actorId: Schema.String,
  roomId: Schema.String,
  toolsOpen: Schema.Boolean,
  mobileMenu: Schema.Boolean,
  roomSection: Schema.Literals(["people", "timer", "handover"]),
  entered: Schema.Boolean,
  board: Schema.NullOr(BoardState),
  private: PrivateState,
  error: Schema.String,
  notice: NoticeBlock.Model,
  invite: Schema.Boolean,
  connected: Schema.Boolean,
  reconnect: Schema.Int,
});

export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  Tools: {},

  RoomUnavailable: {},
  CheckRoom: {},

  MobileMenu: {},
  CloseRoom: {},
  RoomSection: { section: Schema.Literals(["people", "timer", "handover"]) },

  DragStart: { id: Schema.String },
  DragEnd: {},
  DragOver: { id: Schema.String },
  Drop: { id: Schema.String },

  NeedsJoin: {},
  Entered: {
    roomId: Schema.String,
    board: BoardState,
    links: Schema.optionalKey(Schema.Array(InviteLink)),
  },
  Board: { board: Schema.NullOr(BoardState) },
  Private: { state: Schema.NullOr(PrivateState) },

  WatchFailed: { reason: Schema.String },

  Invite: {},

  Notify: { text: Schema.String },

  Retry: {},
});

export type Message = typeof Message.Type;

export const ApplicationDefinition = Block.makeDefinition("Application", {
  Model,
  Message,
  ChildInitContext: Flags,
});
