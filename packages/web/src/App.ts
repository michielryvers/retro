import * as Redacted from "effect/Redacted";
import { inviteToken } from "./inviteToken.ts";
import * as Cause from "effect/Cause";
import { grantParticipant } from "@retro/domain/Room/Access";
import { flow } from "effect/Function";
import * as Option from "effect/Option";
import { InvitationPreview, ErrorResponse } from "@retro/domain/HttpContracts";

import * as Match from "effect/Match";
import { Template, templates, columnsFor } from "@retro/domain/Room/Templates";
import { sortByVotes } from "./voteSort.ts";
import { availableVotes, phaseConfirmation } from "./roomProgress.ts";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Subscription, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import type { Document, HtmlBuilder } from "foldkit/html";
import { Button, Input, Textarea, Select } from "@foldkit/ui";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { BoardState, PrivateState, Column } from "@retro/domain/Room/Values";

type Services = Domain.Api.ClientKey<"RetroApi">;

const Op = Schema.Literals([
  "save",
  "delete",
  "ready",
  "reveal",
  "startVote",
  "vote",
  "votingDone",
  "finishVote",
  "action",
  "deleteAction",
  "close",
  "archive",
  "restore",
]);

const ToolAction = Schema.Literals([
  "start",
  "pause",
  "resume",
  "extend",
  "stop",
  "handover",
  "undo",
  "split",
]);

const Field = Schema.Literals([
  "password",
  "inviteName",
  "handoverTo",
  "deleteTitle",
  "name",
  "title",
  "draft",
  "action",
  "owner",
  "due",
]);

export const Flags = Schema.Struct({
  participantId: Schema.String,
  inviteToken: Schema.String,
  actorId: Schema.String,
  roomId: Schema.String,
  name: Schema.String,
});

const InviteLink = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
});

export const Model = Schema.Struct({
  invitationPreview: Schema.NullOr(InvitationPreview),
  sessionId: Schema.String,
  participantId: Schema.String,
  inviteToken: Schema.String,
  password: Schema.String,
  showPassword: Schema.Boolean,
  unavailable: Schema.Boolean,
  inviteLoading: Schema.Boolean,
  inviteError: Schema.String,
  inviteName: Schema.String,
  inviteLinks: Schema.Array(InviteLink),
  actorId: Schema.String,
  roomId: Schema.String,
  name: Schema.String,
  toolsOpen: Schema.Boolean,
  mobileMenu: Schema.Boolean,
  roomSection: Schema.Literals(["people", "timer", "handover"]),
  handoverTo: Schema.String,
  now: Schema.Number,
  deleteTitle: Schema.String,
  cleanup: Schema.Boolean,
  manageRoom: Schema.Boolean,
  title: Schema.String,
  template: Template,
  entered: Schema.Boolean,
  board: Schema.NullOr(BoardState),
  private: PrivateState,
  busy: Schema.Boolean,
  pendingVote: Schema.String,
  dragSource: Schema.String,
  dropTarget: Schema.String,
  mergeSource: Schema.String,
  mergeTarget: Schema.String,
  screen: Schema.Literals(["board", "actions"]),
  mobileColumn: Column,
  categoryDirection: Schema.Literals(["next", "previous", "none"]),
  actionsOnly: Schema.Boolean,
  voteSort: Schema.Literals(["highest", "lowest", "original"]),
  error: Schema.String,
  notice: Schema.String,
  editor: Schema.NullOr(Column),
  editId: Schema.String,
  draft: Schema.String,
  drafts: Schema.Record(Schema.String, Schema.String),
  draftIds: Schema.Record(Schema.String, Schema.String),
  selected: Schema.String,
  action: Schema.String,
  actionId: Schema.String,
  actionDraftId: Schema.String,
  owner: Schema.String,
  due: Schema.String,
  invite: Schema.Boolean,
  confirm: Schema.String,
  connected: Schema.Boolean,
  reconnect: Schema.Int,
});

export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  PreviewLoaded: { preview: Schema.NullOr(InvitationPreview) },
  Tools: {},
  TogglePassword: {},
  RoomUnavailable: {},
  CheckRoom: {},
  ClearNotice: { text: Schema.String },
  InvitesFailed: { reason: Schema.String },
  RetryInvites: {},
  Split: { id: Schema.String },
  MobileMenu: {},
  CloseRoom: {},
  RoomSection: { section: Schema.Literals(["people", "timer", "handover"]) },
  Tick: { now: Schema.Number },
  Tool: { action: ToolAction, seconds: Schema.Int },
  ToolDone: { board: Schema.NullOr(BoardState), notice: Schema.String },
  Field: { field: Field, value: Schema.String },
  Enter: {},
  DragStart: { id: Schema.String },
  DragEnd: {},
  DragOver: { id: Schema.String },
  Drop: { id: Schema.String },
  MergePick: { id: Schema.String },
  MergeTarget: { id: Schema.String },
  MergeCancel: {},
  MergeConfirm: {},
  Combined: { board: BoardState, noteId: Schema.String },
  Template: { template: Template },
  NeedsJoin: {},
  Entered: {
    roomId: Schema.String,
    board: BoardState,
    links: Schema.optionalKey(Schema.Array(InviteLink)),
  },
  Board: { board: Schema.NullOr(BoardState) },
  Private: { state: Schema.NullOr(PrivateState) },
  Failed: { reason: Schema.String },
  WatchFailed: { reason: Schema.String },
  Edit: { column: Column, id: Schema.String, text: Schema.String },
  CancelEdit: {},
  Select: { id: Schema.String },
  EditAction: { id: Schema.String },
  Run: { op: Op, id: Schema.String, selected: Schema.Boolean },
  Succeeded: { op: Op },
  VoteSaved: { state: Schema.NullOr(PrivateState) },
  Screen: { screen: Schema.Literals(["board", "actions"]) },
  MobileColumn: { column: Column },
  ToggleActions: {},
  VoteSort: { order: Schema.Literals(["highest", "lowest", "original"]) },
  Confirm: { op: Schema.String },
  Invite: {},
  AddInvite: {},
  InvitesLoaded: { links: Schema.Array(InviteLink) },
  Copy: { url: Schema.String },
  Notify: { text: Schema.String },
  Export: {},
  Cleanup: {},
  ManageRoom: {},
  DeleteRoom: {},
  Retry: {},
});

export type Message = typeof Message.Type;

const explain = flow(
  Schema.decodeUnknownOption(Schema.Struct({ reason: Schema.String })),
  Option.match({
    onSome: (e) => e.reason,
    onNone: () =>
      "Could not connect. Your draft is safe here. Please try again.",
  }),
);

export const Enter = Command.define("EnterRoom", {
  args: {
    roomId: Schema.String,
    title: Schema.String,
    name: Schema.String,
    template: Template,
    password: Schema.String,
    participantId: Schema.String,
    token: Schema.String,
  },
  messages: [Message.Entered, Message.Failed, Message.RoomUnavailable],
  execute: ({
    roomId,
    title,
    name,
    template,
    password,
    participantId,
    token,
  }) =>
    Effect.gen(function* () {
      const api = yield* RetroApi.Client;
      const target = RoomId.make(roomId || crypto.randomUUID());

      const receipt = roomId
        ? yield* api.JoinRoom({
            target,
            participantId,
            token: Redacted.make(token),
            password: Redacted.make(password),
          })
        : yield* api.CreateRoom({
            target,
            title,
            name,
            template,
            password: Redacted.make(password),
          });

      if (
        roomId &&
        receipt.reply &&
        "joined" in receipt.reply &&
        !receipt.reply.joined
      )
        return Message.Failed({
          reason: "The invitation or password is incorrect.",
        });
      const board = yield* api.SharedBoard.get(target, { atLeast: receipt });

      if (!board)
        return Message.Failed({
          reason: "The room is still opening. Try again in a moment.",
        });
      yield* Effect.sync(() => {
        try {
          if (name) localStorage.setItem("cg_name", name);
          sessionStorage.removeItem(`cg_invite_${target}`);
        } catch {}

        history.replaceState(null, "", `/room/${target}`);
      });

      const invitations = !roomId
        ? yield* api.Invitations.get(target, { atLeast: receipt }).pipe(
            Effect.timeout("8 seconds"),
            Effect.catchCause(() => Effect.succeed(null)),
          )
        : null;

      const links = invitations
        ? yield* Effect.promise(() =>
            Promise.all(
              invitations.people.map(async (p) => ({
                ...p,
                url: `${location.origin}/room/${target}#invite=${p.id}.${await inviteToken(Redacted.value(invitations.seed), p.id)}`,
              })),
            ),
          )
        : undefined;

      return links
        ? Message.Entered({ roomId: target, board, links })
        : Message.Entered({ roomId: target, board });
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          Cause.pretty(cause).includes("permanently deleted")
            ? Message.RoomUnavailable()
            : Message.Failed({
                reason: explain(Cause.squash(cause)).includes(
                  "already signed in as someone else",
                )
                  ? "This browser is already signed in as someone else in this room. Open this invite in a private window or another browser profile."
                  : explain(Cause.squash(cause)).includes("Too many attempts")
                    ? "Too many attempts. Try again in 15 minutes."
                    : roomId
                      ? "Could not join. Check your personal link and room password, then try again."
                      : "Could not create the room. Please try again.",
              }),
        ),
      ),
    ),
});

const LoadPreview = Command.define("LoadInvitationPreview", {
  args: {
    roomId: Schema.String,
    participantId: Schema.String,
    token: Schema.String,
  },
  messages: [Message.PreviewLoaded],
  execute: (input) =>
    Effect.tryPromise(async () => {
      const response = await fetch("/api/invitation-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });

      return Message.PreviewLoaded({
        preview: response.ok
          ? Schema.decodeUnknownSync(InvitationPreview)(await response.json())
          : null,
      });
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(Message.PreviewLoaded({ preview: null })),
      ),
    ),
});

const Resume = Command.define("ResumeRoom", {
  args: { roomId: Schema.String, invitation: Schema.Boolean },
  messages: [Message.Entered, Message.NeedsJoin, Message.RoomUnavailable],
  execute: ({ roomId, invitation }) =>
    Effect.gen(function* () {
      const api = yield* RetroApi.Client;
      const board = yield* api.SharedBoard.get(RoomId.make(roomId));

      return board && !invitation
        ? Message.Entered({ roomId, board })
        : Message.NeedsJoin();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          Cause.pretty(cause).includes("permanently deleted")
            ? Message.RoomUnavailable()
            : Message.NeedsJoin(),
        ),
      ),
    ),
});

const Facilitate = Command.define("Facilitate", {
  args: {
    roomId: Schema.String,
    action: ToolAction,
    seconds: Schema.Int,
    value: Schema.String,
  },
  messages: [Message.ToolDone, Message.Failed],
  execute: ({ roomId, action, seconds, value }) =>
    Effect.gen(function* () {
      const api = yield* RetroApi.Client;
      const target = RoomId.make(roomId);

      const receipt = yield* Effect.gen(function* () {
        switch (action) {
          case "handover":
            return yield* api.Handover({ target, participantId: value });
          case "split":
            return yield* api.SplitNote({ target, noteId: value });
          case "undo":
            return yield* api.UndoCombine({ target });
          default:
            return yield* api.SetTimer({ target, operation: action, seconds });
        }
      });

      const board = yield* api.SharedBoard.get(target, { atLeast: receipt });

      return Message.ToolDone({
        board,
        notice: Match.value(action).pipe(
          Match.when("split", () => "Notes separated."),
          Match.when("handover", () => "Facilitation handed over."),
          Match.orElse(() => ""),
        ),
      });
    }).pipe(
      Effect.catchCause((e) =>
        Effect.succeed(
          Message.Failed({
            reason: Cause.pretty(e).includes("permanently deleted")
              ? "This room was permanently deleted."
              : explain(Cause.squash(e)),
          }),
        ),
      ),
    ),
});

const Combine = Command.define("CombineRoomNotes", {
  args: {
    roomId: Schema.String,
    sourceId: Schema.String,
    targetId: Schema.String,
  },
  messages: [Message.Combined, Message.Failed],
  execute: ({ roomId, sourceId, targetId }) =>
    Effect.gen(function* () {
      const api = yield* RetroApi.Client;
      const target = RoomId.make(roomId);
      const receipt = yield* api.CombineNotes({ target, sourceId, targetId });
      const board = yield* api.SharedBoard.get(target, { atLeast: receipt });

      return board
        ? Message.Combined({ board, noteId: targetId })
        : Message.Failed({
            reason: "Could not refresh the combined note. Please reload.",
          });
    }).pipe(
      Effect.catchCause((e) =>
        Effect.succeed(
          Message.Failed({
            reason: Cause.pretty(e).includes("permanently deleted")
              ? "This room was permanently deleted."
              : explain(Cause.squash(e)),
          }),
        ),
      ),
    ),
});

export const Mutate = Command.define("RoomCommand", {
  args: {
    roomId: Schema.String,
    op: Op,
    actorId: Schema.String,
    id: Schema.String,
    column: Column,
    text: Schema.String,
    selected: Schema.Boolean,
    noteId: Schema.String,
    ownerId: Schema.String,
    dueDate: Schema.String,
  },
  messages: [Message.Succeeded, Message.VoteSaved, Message.Failed],
  execute: (a) =>
    Effect.gen(function* () {
      const api = yield* RetroApi.Client;

      const base = {
        target: RoomId.make(a.roomId),
        commandId: crypto.randomUUID(),
      };

      switch (a.op) {
        case "save":
          yield* api.SaveNote({
            ...base,
            id: a.id || crypto.randomUUID(),
            column: a.column,
            text: a.text,
          });
          break;
        case "delete":
          yield* api.DeleteNote({ ...base, id: a.id });
          break;
        case "ready":
          yield* api.SetReady({ ...base, ready: a.selected });
          break;
        case "reveal":
          yield* api.RevealNotes(base);
          break;
        case "startVote":
          yield* api.StartVoting(base);
          break;
        case "votingDone":
          yield* api.SetVotingDone({ ...base, done: a.selected });
          break;
        case "vote": {
          const receipt = yield* api.SetVote({
            ...base,
            noteId: a.id,
            selected: a.selected,
          });

          const state = yield* api.MyNotes.get(
            RoomId.make(`${a.roomId}:${a.actorId}`),
            { atLeast: receipt },
          );

          return Message.VoteSaved({ state });
        }

        case "finishVote":
          yield* api.FinishVoting(base);
          break;
        case "action":
          yield* api.SaveAction({
            ...base,
            id: a.id || crypto.randomUUID(),
            noteId: a.noteId,
            text: a.text,
            ownerId: a.ownerId,
            dueDate: a.dueDate,
          });
          break;
        case "deleteAction":
          yield* api.DeleteAction({ ...base, id: a.id });
          break;
        case "archive":
        case "restore":
          yield* api.ArchiveRoom({ ...base, archived: a.op === "archive" });
          break;
        case "close":
          yield* api.CloseRoom(base);
          break;
      }

      return Message.Succeeded({ op: a.op });
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchCause((e) =>
        Effect.succeed(
          Message.Failed({
            reason: Cause.pretty(e).includes("permanently deleted")
              ? "This room was permanently deleted."
              : explain(Cause.squash(e)),
          }),
        ),
      ),
    ),
});

const EnterRoomViewport = Command.define("EnterRoomViewport", {
  args: {},
  messages: [Message.Notify],
  execute: () =>
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: "instant" });
            resolve(Message.Notify({ text: "" }));
          }),
        ),
    ),
});

const FocusMerge = Command.define("FocusCombinePicker", {
  args: {},
  messages: [Message.Notify],
  execute: () =>
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
          requestAnimationFrame(() => {
            document.getElementById("combine-target")?.focus();
            resolve(Message.Notify({ text: "" }));
          }),
        ),
    ),
});

const FocusControl = Command.define("FocusControl", {
  args: { selector: Schema.String },
  messages: [Message.Notify],
  execute: ({ selector }) =>
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
          requestAnimationFrame(() => {
            Array.from(document.querySelectorAll<HTMLElement>(selector))
              .find((element) => element.getClientRects().length)
              ?.focus();
            resolve(Message.Notify({ text: "" }));
          }),
        ),
    ),
});

const FocusAction = Command.define("FocusAction", {
  args: {},
  messages: [Message.Notify],
  execute: () =>
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
          requestAnimationFrame(() => {
            const input = document.getElementById("action");
            input?.closest(".action-form")?.scrollIntoView({ block: "center" });
            input?.focus({ preventScroll: true });
            resolve(Message.Notify({ text: "" }));
          }),
        ),
    ),
});

const LoadInvitations = Command.define("LoadInvitations", {
  args: { roomId: Schema.String, name: Schema.String },
  messages: [Message.InvitesLoaded, Message.InvitesFailed],
  execute: ({ roomId, name }) =>
    Effect.gen(function* () {
      const api = yield* RetroApi.Client;
      const target = RoomId.make(roomId);

      const receipt = name
        ? yield* api.InviteParticipant({ target, name })
        : undefined;

      const invitations = yield* api.Invitations.get(
        target,
        receipt ? { atLeast: receipt } : undefined,
      ).pipe(Effect.timeout("8 seconds"));

      if (!invitations)
        return Message.InvitesFailed({ reason: "Could not load invitations." });

      const links = yield* Effect.promise(() =>
        Promise.all(
          invitations.people.map(async (p) => ({
            ...p,
            url: `${location.origin}/room/${roomId}#invite=${p.id}.${await inviteToken(Redacted.value(invitations.seed), p.id)}`,
          })),
        ),
      );

      return Message.InvitesLoaded({ links });
    }).pipe(
      Effect.catchCause(() =>
        Effect.succeed(
          Message.InvitesFailed({
            reason: "Could not load invitations. Please retry.",
          }),
        ),
      ),
    ),
});

const Copy = Command.define("CopyInvite", {
  args: { url: Schema.String },
  messages: [Message.Notify],
  execute: ({ url }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
      Effect.map(() =>
        Message.Notify({
          text: "Personal link copied. Share the password separately.",
        }),
      ),
      Effect.catch(() =>
        Effect.succeed(
          Message.Notify({ text: "Select and copy the link below." }),
        ),
      ),
    ),
});

const DeleteRetro = Command.define("DeleteRetro", {
  args: { roomId: Schema.String, title: Schema.String },
  messages: [Message.Failed],
  execute: ({ roomId, title }) =>
    Effect.tryPromise(async () => {
      const response = await fetch("/api/room-cleanup", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: roomId, title }),
      });

      if (!response.ok)
        throw new Error(
          Schema.decodeUnknownSync(ErrorResponse)(await response.json()).error,
        );
      window.location.assign("/");

      return Message.Failed({ reason: "" });
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(Message.Failed({ reason: explain(error) })),
      ),
    ),
});

const Export = Command.define("ExportSummary", {
  args: {
    board: BoardState,
    order: Schema.Literals(["highest", "lowest", "original"]),
  },
  messages: [Message.Notify],
  execute: ({ board: b, order }) =>
    Effect.sync(() => {
      const name = (id: string) =>
        b.participants.find((p) => p.id === id)?.name || "Unassigned";

      const text = [
        `# ${b.title}`,
        "",
        ...columnsFor(b.template).flatMap((c) => [
          `## ${c.title}`,
          ...sortByVotes(
            b.notes.filter((n) => n.column === c.id),
            order,
            (n) => b.scores.find((s) => s.noteId === n.id)?.count ?? 0,
          ).map(
            (n) =>
              `- ${n.text} (${b.scores.find((s) => s.noteId === n.id)?.count ?? 0} ${(b.scores.find((s) => s.noteId === n.id)?.count ?? 0) === 1 ? "vote" : "votes"})`,
          ),
          "",
        ]),
        "## Actions",
        ...b.actions.map(
          (a) =>
            `- ${a.text} — ${name(a.ownerId)}${a.dueDate ? ` · due ${a.dueDate}` : ""}`,
        ),
        "",
      ].join("\n");

      const url = URL.createObjectURL(
        new Blob([text], { type: "text/markdown" }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = "retrospective.md";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      return Message.Notify({ text: "Summary downloaded." });
    }),
});

export const init = (
  f: typeof Flags.Type,
): Update.Return<Model, Message, Services> => ({
  model: {
    ...f,
    sessionId: f.actorId,
    invitationPreview: null,
    password: "",
    showPassword: false,
    unavailable: false,
    inviteLoading: false,
    inviteError: "",
    inviteName: "",
    inviteLinks: [],
    toolsOpen: false,
    mobileMenu: false,
    roomSection: "people",
    handoverTo: "",
    now: Date.now(),
    title: "",
    deleteTitle: "",
    cleanup: false,
    manageRoom: false,
    template: "mad-sad-glad",
    entered: false,
    board: null,
    private: { notes: [], votes: [], sessions: [] },
    busy: false,
    pendingVote: "",
    dragSource: "",
    dropTarget: "",
    mergeSource: "",
    mergeTarget: "",
    screen: "board",
    mobileColumn: columnsFor()[0]!.id,
    categoryDirection: "none",
    actionsOnly: false,
    voteSort: "highest",
    error: "",
    notice: "",
    editor: null,
    editId: "",
    draft: "",
    drafts: {},
    draftIds: {},
    selected: "",
    action: "",
    actionId: "",
    actionDraftId: "",
    owner: "",
    due: "",
    invite: false,
    confirm: "",
    connected: false,
    reconnect: 0,
  },
  commands: f.roomId
    ? [
        Resume({ roomId: f.roomId, invitation: Boolean(f.inviteToken) }),
        ...(f.inviteToken && f.participantId
          ? [
              LoadPreview({
                roomId: f.roomId,
                participantId: f.participantId,
                token: f.inviteToken,
              }),
            ]
          : []),
      ]
    : [],
});

export const update = (
  m: Model,
  msg: Message,
): Update.Return<Model, Message, Services> => {
  return Match.value(msg).pipe(
    Match.tagsExhaustive({
      PreviewLoaded: (msg) => ({
        model: m.entered ? m : { ...m, invitationPreview: msg.preview },
      }),
      CheckRoom: () => ({
        model: m,
        commands:
          m.entered && !m.busy
            ? [Resume({ roomId: m.roomId, invitation: true })]
            : [],
      }),
      TogglePassword: () => ({
        model: { ...m, showPassword: !m.showPassword },
      }),
      RoomUnavailable: () => ({
        model: {
          ...m,
          unavailable: true,
          entered: false,
          connected: false,
          busy: false,
          board: null,
        },
      }),
      ClearNotice: (msg) => ({
        model: { ...m, notice: m.notice === msg.text ? "" : m.notice },
      }),
      InvitesFailed: (msg) => ({
        model: {
          ...m,
          inviteLoading: false,
          busy: false,
          inviteError: msg.reason,
        },
      }),
      RetryInvites: () => ({
        model: { ...m, inviteLoading: true, inviteError: "" },
        commands: [LoadInvitations({ roomId: m.roomId, name: "" })],
      }),
      CloseRoom: (): Update.Return<Model, Message, Services> => ({
        model: { ...m, mobileMenu: false, invite: false, toolsOpen: false },
      }),
      MobileMenu: (): Update.Return<Model, Message, Services> => ({
        model: {
          ...m,
          mobileMenu: true,
          roomSection: "people",
          invite: m.board?.adminId === m.actorId,
          toolsOpen: false,
        },
        commands:
          m.board?.adminId === m.actorId
            ? [LoadInvitations({ roomId: m.roomId, name: "" })]
            : [],
      }),
      RoomSection: (msg): Update.Return<Model, Message, Services> => ({
        model: {
          ...m,
          roomSection: msg.section,
          mobileMenu: true,
          invite: msg.section === "people" && m.board?.adminId === m.actorId,
          toolsOpen: msg.section !== "people",
        },
        commands:
          msg.section === "people" && m.board?.adminId === m.actorId
            ? [LoadInvitations({ roomId: m.roomId, name: "" })]
            : [],
      }),
      Split: (msg) =>
        m.busy || m.board?.phase !== "reveal" || m.board.adminId !== m.actorId
          ? { model: m }
          : {
              model: { ...m, busy: true, error: "", selected: "" },
              commands: [
                Facilitate({
                  roomId: m.roomId,
                  action: "split",
                  seconds: 0,
                  value: msg.id,
                }),
              ],
            },
      Tools: (): Update.Return<Model, Message, Services> => ({
        model: {
          ...m,
          toolsOpen: !m.toolsOpen,
          mobileMenu: false,
          invite: false,
          roomSection: "timer",
        },
        commands: [
          FocusControl({
            selector: m.toolsOpen
              ? ".mobile-menu-button, .room-tools-toggle button"
              : ".controls-surface .controls-close button",
          }),
        ],
      }),
      Tick: (msg) => ({ model: { ...m, now: msg.now } }),
      Tool: (msg) =>
        m.busy
          ? { model: m }
          : {
              model: { ...m, busy: true, error: "", notice: "" },
              commands: [
                Facilitate({
                  roomId: m.roomId,
                  action: msg.action,
                  seconds: msg.seconds,
                  value: msg.action === "split" ? m.selected : m.handoverTo,
                }),
              ],
            },
      ToolDone: (msg) => ({
        model: {
          ...m,
          busy: false,
          board: msg.board ?? m.board,
          notice: msg.notice,
          handoverTo: "",
          now: Date.now(),
        },
      }),
      DragStart: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: { ...m, dragSource: m.busy ? "" : msg.id, dropTarget: "" },
        };
      },
      DragEnd: (): Update.Return<Model, Message, Services> => {
        return { model: { ...m, dragSource: "", dropTarget: "" } };
      },
      DragOver: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            dropTarget: m.dragSource && m.dragSource !== msg.id ? msg.id : "",
          },
        };
      },
      Drop: (msg): Update.Return<Model, Message, Services> => {
        if (
          !m.dragSource ||
          !m.board ||
          m.board.phase !== "reveal" ||
          m.dragSource === msg.id ||
          m.busy ||
          m.board?.adminId !== m.actorId
        )
          return { model: m };

        return {
          model: {
            ...m,
            busy: true,
            dragSource: "",
            dropTarget: "",
            error: "",
          },
          commands: [
            Combine({
              roomId: m.roomId,
              sourceId: m.dragSource,
              targetId: msg.id,
            }),
          ],
        };
      },
      MergePick: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            mergeSource: msg.id,
            mergeTarget: "",
            error: "",
            notice: "",
          },
          commands: [FocusMerge({})],
        };
      },
      MergeTarget: (msg): Update.Return<Model, Message, Services> => {
        return { model: { ...m, mergeTarget: msg.id } };
      },
      MergeCancel: (): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            mergeSource: "",
            mergeTarget: "",
            dragSource: "",
            dropTarget: "",
          },
        };
      },
      MergeConfirm: (): Update.Return<Model, Message, Services> => {
        if (
          m.busy ||
          !m.mergeSource ||
          !m.mergeTarget ||
          m.mergeSource === m.mergeTarget ||
          m.board?.adminId !== m.actorId ||
          m.board.phase !== "reveal"
        )
          return { model: m };

        return {
          model: { ...m, busy: true, error: "" },
          commands: [
            Combine({
              roomId: m.roomId,
              sourceId: m.mergeSource,
              targetId: m.mergeTarget,
            }),
          ],
        };
      },
      Combined: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            board: msg.board,
            busy: false,
            screen: "board",
            mobileColumn:
              msg.board.notes.find((n) => n.id === msg.noteId)?.column ??
              m.mobileColumn,
            mergeSource: "",
            mergeTarget: "",
            selected: "",
            notice: "Notes combined.",
          },
        };
      },
      Template: (msg): Update.Return<Model, Message, Services> => {
        return { model: { ...m, template: msg.template } };
      },
      Screen: (msg): Update.Return<Model, Message, Services> => {
        return { model: { ...m, screen: msg.screen, selected: "" } };
      },
      ToggleActions: (): Update.Return<Model, Message, Services> => {
        if (
          m.selected ||
          !m.board ||
          !["actions", "closed"].includes(m.board.phase)
        )
          return { model: m };
        const actionsOnly = !m.actionsOnly;

        const first = m.board.notes.find((n) =>
          m.board?.actions.some((a) => a.noteId === n.id),
        );

        return {
          model: {
            ...m,
            actionsOnly,
            mobileColumn: actionsOnly && first ? first.column : m.mobileColumn,
          },
        };
      },
      VoteSort: (msg): Update.Return<Model, Message, Services> => {
        return { model: { ...m, voteSort: msg.order } };
      },
      MobileColumn: (msg): Update.Return<Model, Message, Services> => {
        if (m.busy || msg.column === m.mobileColumn) return { model: m };

        if (m.selected)
          return {
            model: {
              ...m,
              notice: "Save or cancel this action before switching categories.",
            },
          };

        if (m.editId && m.editor !== msg.column)
          return {
            model: {
              ...m,
              notice: "Save or cancel your edit before switching categories.",
            },
          };

        return {
          model: {
            ...m,
            mobileColumn: msg.column,
            draft: m.drafts[msg.column] ?? "",
            categoryDirection:
              columnsFor(m.board?.template).findIndex((column) => column.id === msg.column) >
              columnsFor(m.board?.template).findIndex((column) => column.id === m.mobileColumn)
                ? "next"
                : "previous",
            editor: m.editor ? msg.column : null,
          },
        };
      },
      VoteSaved: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            busy: false,
            pendingVote: "",
            private: msg.state ?? m.private,
          },
        };
      },
      Field: (msg): Update.Return<Model, Message, Services> => {
        if (m.busy) return { model: m };

        if (msg.field === "draft" && !m.editId)
          return {
            model: {
              ...m,
              draft: msg.value,
              drafts: { ...m.drafts, [m.editor ?? m.mobileColumn]: msg.value },
            },
          };

        return { model: { ...m, [msg.field]: msg.value } };
      },
      NeedsJoin: (): Update.Return<Model, Message, Services> => {
        return { model: { ...m, busy: false } };
      },
      Enter: (): Update.Return<Model, Message, Services> => {
        if (m.busy) return { model: m };

        return {
          model: { ...m, busy: true, error: "" },
          commands: [
            Enter({
              roomId: m.roomId,
              title: m.title,
              name: m.name,
              template: m.template,
              password: m.password,
              participantId: m.participantId,
              token: m.inviteToken,
            }),
          ],
        };
      },
      Entered: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            roomId: msg.roomId,
            actorId: grantParticipant(msg.board.grants, m.sessionId) ?? "",
            password: "",
            inviteToken: "",
            invite: !m.roomId || m.invite,
            inviteLinks: msg.links ?? m.inviteLinks,
            inviteLoading: false,
            inviteError:
              !m.roomId && !msg.links
                ? "Could not load invitations. Please retry."
                : "",
            board: msg.board,
            mobileColumn: columnsFor(msg.board?.template).some(
              (c) => c.id === m.mobileColumn,
            )
              ? m.mobileColumn
              : columnsFor(msg.board?.template)[0]!.id,
            notice:
              m.board && msg.board && m.board.adminId !== msg.board.adminId
                ? msg.board.adminId === m.actorId
                  ? "You are now the facilitator."
                  : `${msg.board.participants.find((p) => p.id === msg.board?.adminId)?.name ?? "A teammate"} is now facilitating.`
                : m.notice,
            roomSection:
              msg.board?.adminId === m.actorId ? m.roomSection : "people",
            toolsOpen: msg.board?.adminId === m.actorId && m.toolsOpen,
            mergeSource:
              msg.board?.phase === m.board?.phase &&
              msg.board?.notes.some((n) => n.id === m.mergeSource)
                ? m.mergeSource
                : "",
            mergeTarget:
              msg.board?.phase === m.board?.phase &&
              msg.board?.notes.some((n) => n.id === m.mergeTarget)
                ? m.mergeTarget
                : "",
            screen: "board",
            entered: true,
            busy: false,
            connected: true,
            error: "",
          },
          commands: m.entered ? [] : [EnterRoomViewport({})],
        };
      },
      Board: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            board: msg.board,
            mobileColumn: columnsFor(msg.board?.template).some(
              (c) => c.id === m.mobileColumn,
            )
              ? m.mobileColumn
              : columnsFor(msg.board?.template)[0]!.id,
            notice:
              m.board && msg.board && m.board.adminId !== msg.board.adminId
                ? msg.board.adminId === m.actorId
                  ? "You are now the facilitator."
                  : `${msg.board.participants.find((p) => p.id === msg.board?.adminId)?.name ?? "A teammate"} is now facilitating.`
                : m.notice,
            roomSection:
              msg.board?.adminId === m.actorId ? m.roomSection : "people",
            toolsOpen: msg.board?.adminId === m.actorId && m.toolsOpen,
            mergeSource:
              msg.board?.phase === m.board?.phase &&
              msg.board?.notes.some((n) => n.id === m.mergeSource)
                ? m.mergeSource
                : "",
            mergeTarget:
              msg.board?.phase === m.board?.phase &&
              msg.board?.notes.some((n) => n.id === m.mergeTarget)
                ? m.mergeTarget
                : "",
            screen: "board",
            voteSort:
              msg.board?.phase === "actions" && m.board?.phase !== "actions"
                ? "highest"
                : m.voteSort,
            connected: true,
            error: m.connected ? m.error : "",
            confirm: msg.board?.phase !== m.board?.phase ? "" : m.confirm,
          },
        };
      },
      Private: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            private: msg.state ?? { notes: [], votes: [], sessions: [] },
          },
        };
      },
      Failed: (msg): Update.Return<Model, Message, Services> => {
        if (msg.reason.includes("permanently deleted"))
          return {
            model: {
              ...m,
              unavailable: true,
              entered: false,
              connected: false,
              busy: false,
              board: null,
            },
          };

        return {
          model: {
            ...m,
            busy: false,
            pendingVote: "",
            error:
              msg.reason === "Only the facilitator can manage invitations."
                ? ""
                : msg.reason,
          },
        };
      },
      WatchFailed: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: { ...m, connected: false, error: msg.reason },
          commands: m.roomId
            ? [Resume({ roomId: m.roomId, invitation: true })]
            : [],
        };
      },
      Edit: (msg): Update.Return<Model, Message, Services> => {
        if (m.busy) return { model: m };

        if (m.editId && m.editId !== msg.id)
          return {
            model: {
              ...m,
              notice: "Save or cancel your edit before opening another note.",
            },
          };

        return {
          model: {
            ...m,
            editor: msg.column,
            mobileColumn: msg.column,
            editId: msg.id,
            draft: msg.text,
            error: "",
            selected: "",
          },
        };
      },
      CancelEdit: (): Update.Return<Model, Message, Services> => {
        if (m.busy) return { model: m };
        const column = m.editor ?? m.mobileColumn;
        const drafts = m.editId ? m.drafts : { ...m.drafts, [column]: "" };

        return {
          model: {
            ...m,
            editor: null,
            draft: drafts[column] ?? "",
            drafts,
            draftIds: m.editId ? m.draftIds : { ...m.draftIds, [column]: "" },
            editId: "",
          },
        };
      },
      EditAction: (msg): Update.Return<Model, Message, Services> => {
        if (
          m.busy ||
          m.board?.phase !== "actions" ||
          m.board.adminId !== m.actorId
        )
          return { model: m };
        const action = m.board.actions.find((a) => a.id === msg.id);

        if (!action) return { model: m };

        if (m.selected && m.action.trim())
          return {
            model: { ...m, notice: "Save or cancel this action first." },
          };

        return {
          model: {
            ...m,
            selected: action.noteId,
            actionId: action.id,
            action: action.text,
            owner: action.ownerId,
            due: action.dueDate,
          },
          commands: [FocusAction({})],
        };
      },
      Select: (msg): Update.Return<Model, Message, Services> => {
        if (
          m.busy ||
          m.board?.phase !== "actions" ||
          m.board.adminId !== m.actorId
        )
          return { model: m };

        if (m.selected && msg.id && m.selected !== msg.id && m.action.trim())
          return {
            model: {
              ...m,
              notice: "Save or cancel this action before opening another.",
            },
          };

        return {
          model: {
            ...m,
            selected: msg.id,
            action: "",
            actionId: "",
            actionDraftId: "",
            owner: "",
            due: "",
          },
          commands: msg.id ? [FocusAction({})] : [],
        };
      },
      Confirm: (msg): Update.Return<Model, Message, Services> => {
        return {
          model: { ...m, confirm: msg.op },
          commands: [
            FocusControl({
              selector: msg.op
                ? ".confirm-bar button"
                : ".session-footer .primary",
            }),
          ],
        };
      },
      Invite: (): Update.Return<Model, Message, Services> => ({
        model: {
          ...m,
          invite: !m.invite,
          mobileMenu: false,
          toolsOpen: false,
          roomSection: "people",
          notice: "",
          inviteLoading: !m.invite,
          inviteError: "",
        },
        commands:
          m.invite || m.board?.adminId !== m.actorId
            ? []
            : [LoadInvitations({ roomId: m.roomId, name: "" })],
      }),
      AddInvite: () => ({
        model: { ...m, busy: true, error: "" },
        commands: [
          LoadInvitations({ roomId: m.roomId, name: m.inviteName.trim() }),
        ],
      }),
      InvitesLoaded: (msg) => ({
        model: {
          ...m,
          inviteLinks: msg.links,
          inviteLoading: false,
          inviteError: "",
          inviteName: "",
          busy: false,
        },
      }),
      Copy: (msg) => ({ model: m, commands: [Copy({ url: msg.url })] }),
      ManageRoom: () => ({
        model: { ...m, manageRoom: !m.manageRoom, cleanup: false },
      }),
      Cleanup: (): Update.Return<Model, Message, Services> => {
        return { model: { ...m, cleanup: !m.cleanup, deleteTitle: "" } };
      },
      DeleteRoom: (): Update.Return<Model, Message, Services> => {
        if (
          m.busy ||
          !m.board ||
          m.board.adminId !== m.actorId ||
          m.board.phase !== "closed" ||
          m.deleteTitle !== m.board.title
        )
          return { model: m };

        return {
          model: { ...m, busy: true, error: "" },
          commands: [DeleteRetro({ roomId: m.roomId, title: m.deleteTitle })],
        };
      },
      Export: (): Update.Return<Model, Message, Services> => {
        return {
          model: m,
          commands: m.board
            ? [Export({ board: m.board, order: m.voteSort })]
            : [],
        };
      },
      Notify: (msg): Update.Return<Model, Message, Services> => {
        return { model: { ...m, notice: msg.text } };
      },
      Retry: (): Update.Return<Model, Message, Services> => {
        return {
          model: {
            ...m,
            reconnect: m.reconnect + 1,
            error: "",
            connected: false,
          },
        };
      },
      Run: (msg): Update.Return<Model, Message, Services> => {
        if (m.busy) return { model: m };

        if (
          (msg.op === "action" || msg.op === "deleteAction") &&
          (m.board?.phase !== "actions" || m.board.adminId !== m.actorId)
        )
          return { model: m };

        const column = m.editor ?? m.mobileColumn;
        const noteId = m.editId || m.draftIds[column] || crypto.randomUUID();
        const actionId = m.actionId || m.actionDraftId || crypto.randomUUID();

        return {
          model: {
            ...m,
            actionDraftId: msg.op === "action" ? actionId : m.actionDraftId,
            draftIds:
              msg.op === "save" && !m.editId
                ? { ...m.draftIds, [column]: noteId }
                : m.draftIds,
            busy: true,
            pendingVote: msg.op === "vote" ? msg.id : "",
            error: "",
            notice: "",
            confirm: "",
          },
          commands: [
            Mutate({
              roomId: m.roomId,
              actorId: m.actorId,
              op: msg.op,
              id: Match.value(msg.op).pipe(
                Match.when("save", () => noteId),
                Match.when("action", () => actionId),
                Match.orElse(() => msg.id),
              ),
              column: m.editor ?? m.mobileColumn,
              text: Match.value(msg.op).pipe(
                Match.when("action", () => m.action),
                Match.orElse(() => m.draft),
              ),
              selected: msg.selected,
              noteId: m.selected,
              ownerId: m.owner,
              dueDate: m.due,
            }),
          ],
        };
      },
      Succeeded: (msg): Update.Return<Model, Message, Services> => {
        let model: Model = { ...m, busy: false, error: "" };

        if (msg.op === "save" || msg.op === "delete") {
          const column = m.editor ?? m.mobileColumn;
          const drafts = m.editId ? m.drafts : { ...m.drafts, [column]: "" };
          model = {
            ...model,
            editor: null,
            editId: "",
            drafts,
            draftIds: m.editId ? m.draftIds : { ...m.draftIds, [column]: "" },
            draft: drafts[column] ?? "",
          };
        }

        if (msg.op === "action")
          model = {
            ...model,
            action: "",
            actionId: "",
            actionDraftId: "",
            owner: "",
            due: "",
            selected: "",
            notice: m.actionId ? "Action updated." : "Action added.",
          };

        if (msg.op === "deleteAction")
          model = { ...model, notice: "Action deleted." };

        return { model };
      },
    }),
  );
};

export const subscriptions = Subscription.make<Model, Message, Services>()(
  (entry) => ({
    reconnect: entry(
      { active: Schema.Boolean },
      {
        modelToDependencies: (m) => ({ active: m.entered && !m.connected }),
        dependenciesToStream: ({ active }) =>
          active
            ? Stream.tick("5 seconds").pipe(
                Stream.filter(() => navigator.onLine),
                Stream.map(() => Message.Retry()),
              )
            : Stream.empty,
      },
    ),
    network: entry(
      { active: Schema.Boolean },
      {
        modelToDependencies: (m) => ({ active: m.entered }),
        dependenciesToStream: ({ active }) =>
          active
            ? Stream.merge(
                Stream.fromEventListener(window, "online").pipe(
                  Stream.map(() => Message.Retry()),
                ),
                Stream.fromEventListener(window, "offline").pipe(
                  Stream.map(() =>
                    Message.WatchFailed({
                      reason:
                        "You’re offline. Reconnecting when your connection returns.",
                    }),
                  ),
                ),
              )
            : Stream.empty,
      },
    ),
    focus: entry(
      { active: Schema.Boolean },
      {
        modelToDependencies: (m) => ({ active: m.entered }),
        dependenciesToStream: ({ active }) =>
          active
            ? Stream.fromEventListener(window, "focus").pipe(
                Stream.map(() => Message.CheckRoom()),
              )
            : Stream.empty,
      },
    ),
    notice: entry(
      { text: Schema.String },
      {
        modelToDependencies: (m) => ({ text: m.notice }),
        dependenciesToStream: ({ text }) =>
          text
            ? Stream.fromEffect(
                Effect.sleep("4 seconds").pipe(
                  Effect.as(Message.ClearNotice({ text })),
                ),
              )
            : Stream.empty,
      },
    ),
    clock: entry(
      { active: Schema.Boolean },
      {
        modelToDependencies: (m) => ({
          active: Boolean(
            m.entered && m.board?.timer?.endsAt && m.board.phase !== "closed",
          ),
        }),
        dependenciesToStream: ({ active }) =>
          active
            ? Stream.tick("1 second").pipe(
                Stream.map(() => Message.Tick({ now: Date.now() })),
              )
            : Stream.empty,
      },
    ),
    board: entry(
      { roomId: Schema.String, entered: Schema.Boolean, reconnect: Schema.Int },
      {
        modelToDependencies: (m) => ({
          roomId: m.roomId,
          entered: m.entered,
          reconnect: m.reconnect,
        }),
        dependenciesToStream: ({ roomId, entered }) =>
          entered
            ? Stream.unwrap(
                Effect.gen(function* () {
                  const api = yield* RetroApi.Client;

                  return api.SharedBoard.watch(RoomId.make(roomId));
                }),
              ).pipe(
                Stream.map((board) => Message.Board({ board })),
                Stream.catchCause((e) =>
                  Stream.succeed(
                    Cause.pretty(e).includes("permanently deleted")
                      ? Message.RoomUnavailable()
                      : Message.WatchFailed({
                          reason: "Connection interrupted. Reconnecting…",
                        }),
                  ),
                ),
              )
            : Stream.empty,
      },
    ),
    mine: entry(
      {
        roomId: Schema.String,
        actorId: Schema.String,
        entered: Schema.Boolean,
        reconnect: Schema.Int,
      },
      {
        modelToDependencies: (m) => ({
          roomId: m.roomId,
          actorId: m.actorId,
          entered: m.entered,
          reconnect: m.reconnect,
        }),
        dependenciesToStream: ({ roomId, actorId, entered }) =>
          entered
            ? Stream.unwrap(
                Effect.gen(function* () {
                  const api = yield* RetroApi.Client;

                  return api.MyNotes.watch(RoomId.make(`${roomId}:${actorId}`));
                }),
              ).pipe(
                Stream.map((state) => Message.Private({ state })),
                Stream.catchCause((e) =>
                  Stream.succeed(
                    Cause.pretty(e).includes("permanently deleted")
                      ? Message.RoomUnavailable()
                      : Message.WatchFailed({
                          reason: "Connection interrupted. Reconnecting…",
                        }),
                  ),
                ),
              )
            : Stream.empty,
      },
    ),
  }),
);

const steps = [
  { id: "write", title: "Write", caption: "Add your notes" },
  { id: "reveal", title: "Reveal", caption: "See everyone’s notes" },
  { id: "vote", title: "Vote", caption: "Choose what matters" },
  { id: "actions", title: "Actions", caption: "Turn insights into next steps" },
];

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

export const view = (m: Model, h: HtmlBuilder<Message>): Document => {
  const icon = (name: string) =>
    h.i([h.Class(`ph ph-${name}`), h.AriaHidden(true)]);

  const button = (
    text: string,
    msg: Message,
    style = "secondary",
    disabled = false,
    ic?: string,
  ) =>
    Button.view(
      {
        onClick: msg,
        isDisabled: disabled || (m.busy && !m.pendingVote),
        toView: (a) =>
          h.button(
            [
              ...a.button,
              h.Class(`button ${style}`),
              ...(style === "icon-button" ? [h.AriaLabel(text), h.Title(text)] : []),
            ],
            [...(ic ? [icon(ic)] : []), ...(style === "icon-button" ? [] : [text])],
          ),
      },
      h,
    );

  const field = (
    id: typeof Field.Type,
    label: string,
    value: string,
    placeholder = "",
    type = "text",
  ) =>
    Input.view(
      {
        id,
        value,
        type,
        placeholder,
        onInput: (value) => Message.Field({ field: id, value }),
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label([...a.label], [label]),
              h.div(
                [h.Class("input-control")],
                [
                  h.input([
                    ...a.input,
                    h.Disabled(m.busy),
                    h.Maxlength(
                      Match.value(id).pipe(
                        Match.when("name", () => 40),
                        Match.when("title", () => 100),
                        Match.orElse(() => 500),
                      ),
                    ),
                  ]),
                  id === "password"
                    ? h.button(
                        [
                          h.Type("button"),
                          h.Class("password-toggle"),
                          h.AriaLabel(
                            m.showPassword ? "Hide password" : "Show password",
                          ),
                          h.Disabled(m.busy),
                          h.OnClick(Message.TogglePassword()),
                        ],
                        [icon(m.showPassword ? "eye-slash" : "eye")],
                      )
                    : null,
                ],
              ),
            ],
          ),
      },
      h,
    );

  const textarea = (
    id: "draft" | "action",
    label: string,
    value: string,
    placeholder: string,
  ) =>
    Textarea.view(
      {
        id,
        value,
        placeholder,
        rows: 3,
        onInput: (value) => Message.Field({ field: id, value }),
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label(
                [...a.label, ...(id === "action" ? [] : [h.Class("sr-only")])],
                [label],
              ),
              h.textarea([
                ...a.textarea,
                h.Maxlength(id === "action" ? 500 : 2000),
                h.Disabled(m.busy),
              ]),
            ],
          ),
      },
      h,
    );

  const run = (op: typeof Op.Type, id = "", selected = false) =>
    Message.Run({ op, id, selected });

  const columns = columnsFor(m.board?.template ?? m.template);

  const writingPrompts = new Map([
    ["Start", "What should we start doing?"],
    ["Stop", "What should we stop doing?"],
    ["Continue", "What should we keep doing?"],
    ["Mad", "What frustrated you?"],
    ["Sad", "What was disappointing?"],
    ["Glad", "What went well?"],
    ["Went Well", "What went well?"],
    ["Improve", "What could be better?"],
    ["Try", "What could we try next?"],
    ["Keep", "What should we keep doing?"],
    ["Drop", "What can we let go of?"],
  ]);

  const feedback = () =>
    h.div(
      [h.Class("feedback")],
      [
        m.error
          ? h.div(
              [h.Class("error"), h.Role("alert")],
              [icon("warning-circle"), m.error],
            )
          : null,
        m.notice
          ? h.p(
              [h.Role("status"), h.Class("notice")],
              [icon("check-circle"), m.notice],
            )
          : null,
      ],
    );

  if (m.unavailable)
    return {
      title: "Retrospective deleted",
      body: h.main(
        [h.Class("unavailable-room")],
        [
          h.h1([], ["This retrospective has been deleted"]),
          h.p([], ["Its notes and actions are no longer available."]),
          h.a(
            [h.Href("/"), h.Class("button primary")],
            ["Back to retrospectives"],
          ),
        ],
      ),
    };

  if (!m.entered || !m.board)
    return {
      title: "Retro",
      body: h.div(
        [h.Class("welcome")],
        [
          h.main(
            [h.Class("welcome-main")],
            [
              h.form(
                [h.Class("entry-form"), h.OnSubmit(Message.Enter())],
                [
                  h.a(
                    [h.Class("entry-brand"), h.Href("/")],
                    [
                      h.img([h.Src("/retro.svg"), h.Alt("")]),
                      h.span([], ["Retro"]),
                    ],
                  ),
                  h.h2(
                    [],
                    [
                      m.roomId
                        ? m.invitationPreview
                          ? `Hi, ${m.invitationPreview.name}.`
                          : "Join the retrospective"
                        : "Create a retrospective",
                    ],
                  ),
                  m.roomId && m.invitationPreview
                    ? h.p(
                        [h.Class("invitation-welcome")],
                        [
                          "You’re invited to ",
                          h.strong([], [m.invitationPreview.title]),
                          ".",
                        ],
                      )
                    : null,
                  m.roomId && !m.inviteToken
                    ? h.p(
                        [h.Class("subtle")],
                        [
                          "Ask your facilitator for your personal invitation link.",
                        ],
                      )
                    : null,
                  ...(!m.roomId
                    ? [
                        field(
                          "title",
                          "Room name",
                          m.title,
                          "e.g. Sprint 24 retrospective",
                        ),
                      ]
                    : []),
                  !m.roomId
                    ? h.fieldset(
                        [h.Class("template-picker")],
                        [
                          h.legend([], ["Retrospective format"]),
                          ...Object.entries(templates).map(([id, template]) =>
                            h.label(
                              [
                                h.Class(
                                  `template-option ${m.template === id ? "selected" : ""}`,
                                ),
                              ],
                              [
                                h.input([
                                  h.Type("radio"),
                                  h.Name("template"),
                                  h.Value(id),
                                  h.Checked(m.template === id),
                                  h.Disabled(m.busy),
                                  h.OnChange(() =>
                                    Message.Template({
                                      template:
                                        Schema.decodeUnknownSync(Template)(id),
                                    }),
                                  ),
                                ]),
                                h.strong(
                                  [h.Class("format-categories")],
                                  template.title
                                    .split(" / ")
                                    .flatMap((name, index) => [
                                      ...(index
                                        ? [
                                            h.span(
                                              [h.Class("format-separator")],
                                              ["/"],
                                            ),
                                          ]
                                        : []),
                                      h.span(
                                        [
                                          h.Class(
                                            `format-category format-category-${index}`,
                                          ),
                                        ],
                                        [name],
                                      ),
                                    ]),
                                ),
                              ],
                            ),
                          ),
                        ],
                      )
                    : null,
                  !m.roomId
                    ? field("name", "Your name", m.name, "e.g. Alex")
                    : null,
                  !m.roomId || m.inviteToken
                    ? field(
                        "password",
                        "Room password",
                        m.password,
                        !m.roomId
                          ? "At least 3 characters"
                          : "Password from your facilitator",
                        m.showPassword ? "text" : "password",
                      )
                    : null,
                  feedback(),
                  !m.roomId ? h.p([h.Class("muted")], [
                    "Rooms close after 7 days and are deleted 7 days after closing.",
                  ]) : null,

                  !m.roomId || m.inviteToken
                    ? Button.view(
                        {
                          type: "submit",
                          isDisabled:
                            m.busy ||
                            (!m.roomId &&
                              (!m.name.trim() ||
                                !m.title.trim() ||
                                m.password.length < 3)) ||
                            (Boolean(m.roomId) &&
                              (!m.inviteToken || !m.password)),
                          toView: (a) =>
                            h.button(
                              [
                                ...a.button,
                                h.Class(
                                  `button primary wide ${m.busy ? "entry-loading" : ""}`,
                                ),
                              ],
                              [
                                m.busy
                                  ? m.roomId
                                    ? "Joining your room…"
                                    : "Creating your room…"
                                  : m.roomId
                                    ? "Join room"
                                    : "Create room",
                                m.busy
                                  ? h.span(
                                      [
                                        h.Class("loading-notes"),
                                        h.AriaHidden(true),
                                      ],
                                      [
                                        h.span([], []),
                                        h.span([], []),
                                        h.span([], []),
                                      ],
                                    )
                                  : icon("arrow-right"),
                              ],
                            ),
                        },
                        h,
                      )
                    : null,
                  h.div(
                    [
                      h.Class("entry-progress"),
                      h.Role("status"),
                      h.AriaLive("polite"),
                    ],
                    [
                      m.busy
                        ? m.roomId
                          ? "Finding your seat…"
                          : "Putting the sticky notes out…"
                        : "",
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    };
  const b = m.board;
  const me = b.participants.find((p) => p.id === m.actorId);
  const admin = b.adminId === m.actorId;

  const timerMs = b.timer?.endsAt
    ? Math.max(0, b.timer.endsAt - m.now)
    : (b.timer?.remainingMs ?? 0);

  const timerSeconds = Math.ceil(timerMs / 1000);
  const timerText = `${Math.floor(timerSeconds / 60)}:${String(timerSeconds % 60).padStart(2, "0")}`;

  const tool = (action: typeof ToolAction.Type, seconds = 0) =>
    Message.Tool({ action, seconds });

  const writing = b.phase === "write";
  const canCombine = admin && b.phase === "reveal";
  const active = steps.findIndex((s) => s.id === b.phase);
  const allNotes = writing ? m.private.notes : b.notes;

  const visibleNotes =
    m.actionsOnly && !writing
      ? allNotes.filter((n) => b.actions.some((a) => a.noteId === n.id))
      : allNotes;

  const columnCount = (id: typeof Column.Type) =>
    m.actionsOnly
      ? visibleNotes.filter((n) => n.column === id).length
      : (b.tally[id] ?? 0);

  const ready = b.participants.filter((p) => p.ready).length;

  const titles = {
    write: "Write notes",
    reveal: "Review notes",
    vote: "Vote on notes",
    actions: "Plan actions",
    closed: "Retrospective complete",
  };

  const avatar = (p: BoardState["participants"][number], i: number) =>
    h.span(
      [
        h.Class(`avatar color-${i % 6}`),
        h.Title(p.name + (p.id === m.actorId ? " (you)" : "")),
      ],
      [initials(p.name)],
    );

  const selected = b.notes.find((n) => n.id === m.selected);

  const score = (id: string) =>
    b.scores.find((s) => s.noteId === id)?.count ?? 0;

  const resultsVisible = b.phase === "actions" || b.phase === "closed";

  const actionForm =
    admin && selected && b.phase === "actions"
      ? h.form(
          [h.Class("action-form"), h.OnSubmit(run("action"))],
          [
            textarea(
              "action",
              "What will we do?",
              m.action,
              "A concrete next step",
            ),
            h.div(
              [h.Class("form-row")],
              [
                Select.view(
                  {
                    id: "owner",
                    value: m.owner,
                    onChange: (value) =>
                      Message.Field({ field: "owner", value }),
                    toView: (a) =>
                      h.div(
                        [h.Class("field")],
                        [
                          h.label([...a.label], ["Owner"]),
                          h.select(
                            [...a.select],
                            [
                              h.option([h.Value("")], ["Choose an owner"]),
                              ...b.participants.map((p) =>
                                h.option([h.Value(p.id)], [p.name]),
                              ),
                            ],
                          ),
                        ],
                      ),
                  },
                  h,
                ),
                field("due", "Due date (optional)", m.due, "", "date"),
              ],
            ),
            h.div(
              [h.Class("action-form-controls")],
              [
                button(
                  "Save action",
                  run("action"),
                  "primary",
                  m.busy || !m.action.trim(),
                  "check",
                ),
                button(
                  "Cancel",
                  Message.Select({ id: "" }),
                  "secondary",
                  m.busy,
                ),
              ],
            ),
          ],
        )
      : null;

  const primary = Match.value(b.phase).pipe(
    Match.when("write", () => ({
      op: "reveal" as const,
      label: "Reveal notes",
      icon: "eye",
    })),
    Match.when("reveal", () => ({
      op: "startVote" as const,
      label: "Start voting",
      icon: "hand-pointing",
    })),
    Match.when("vote", () => ({
      op: "finishVote" as const,
      label: "Finish voting",
      icon: "chart-bar",
    })),
    Match.when("actions", () => ({
      op: "close" as const,
      label: "Close retrospective",
      icon: "check-circle",
    })),
    Match.orElse(() => null),
  );

  return {
    title: `${b.title} · Retrospective`,
    body: h.div(
      [
        h.Class(
          `app-shell ${b.phase === "closed" ? "closed-screen" : ""} ${selected ? "action-editing" : ""} ${writing ? "writing-screen" : ""} ${admin ? "facilitator-screen" : "participant-screen"}`,
        ),
      ],
      [
        h.header(
          [h.Class("mobile-room-header")],
          [
            h.div(
              [h.Class("mobile-room-top")],
              [
                h.img([
                  h.Class("room-logo"),
                  h.Src("/retro.svg"),
                  h.Alt("Retro"),
                ]),
                h.strong([], [b.title]),
                h.div(
                  [h.Class("mobile-presence")],
                  [
                    h.div(
                      [h.Class("participant-stack")],
                      b.participants
                        .slice(0, 3)
                        .map((p, i) =>
                          h.span(
                            [
                              h.Class(
                                `participant-stamp ${writing && p.ready ? "is-ready" : ""}`,
                              ),
                              h.AriaLabel(
                                `${p.name}${writing && p.ready ? ", ready" : ""}`,
                              ),
                            ],
                            [
                              avatar(p, i),
                              writing && p.ready ? icon("check") : null,
                            ],
                          ),
                        ),
                    ),
                    h.span(
                      [h.Class("subtle")],
                      [
                        `${b.participants.length} ${b.participants.length === 1 ? "person" : "people"}`,
                      ],
                    ),
                  ],
                ),
                h.button(
                  [
                    h.Class("mobile-menu-button"),
                    h.AriaLabel("Room menu"),
                    h.AriaExpanded(m.mobileMenu || m.invite || m.toolsOpen),
                    h.OnClick(Message.MobileMenu()),
                  ],
                  [icon("dots-three")],
                ),
              ],
            ),
            h.div(
              [h.Class("mobile-room-status"), h.Role("status")],
              [
                h.span(
                  [h.Key(b.phase)],
                  [
                    b.phase === "closed"
                      ? b.archived
                        ? "Archived · read-only"
                        : "Session complete"
                      : `${writing ? "Writing" : steps[active]?.title} · ${active + 1} of 4`,
                  ],
                ),
                !m.connected
                  ? h.span([h.Class("connection")], ["Reconnecting…"])
                  : null,
                b.phase !== "closed" &&
                (b.timer?.endsAt || b.timer?.remainingMs)
                  ? h.span(
                      [
                        h.Class("mobile-countdown"),
                        h.AriaLabel("Shared timer"),
                      ],
                      [
                        icon("timer"),
                        timerText,
                        !b.timer?.endsAt
                          ? " · paused"
                          : !timerSeconds
                            ? " · time’s up"
                            : "",
                      ],
                    )
                  : null,
              ],
            ),
          ],
        ),
        h.aside(
          [h.Class("sidebar")],
          [
            h.div(
              [h.Class("room-info")],
              [
                h.img([
                  h.Class("room-logo"),
                  h.Src("/retro.svg"),
                  h.Alt("Retro"),
                ]),
                h.h2([], [b.title]),
                h.p(
                  [h.Class("subtle")],
                  [
                    `${b.participants.length} ${b.participants.length === 1 ? "person" : "people"} in this room`,
                  ],
                ),
              ],
            ),
            h.nav(
              [h.AriaLabel("Retrospective progress"), h.Class("steps")],
              steps.map((s, i) =>
                h.div(
                  [
                    h.Class(
                      `step ${i === active ? "current" : ""} ${i < active || b.phase === "closed" ? "complete" : ""}`,
                    ),
                    ...(i === active ? [h.AriaCurrent("step")] : []),
                  ],
                  [
                    h.span(
                      [h.Class("step-marker")],
                      [
                        i < active || b.phase === "closed"
                          ? icon("check")
                          : String(i + 1),
                      ],
                    ),
                    h.div(
                      [],
                      [h.strong([], [s.title]), h.span([], [s.caption])],
                    ),
                  ],
                ),
              ),
            ),
            h.div(
              [h.Class("sidebar-bottom")],
              [
                h.p(
                  [],
                  [
                    icon(admin ? "crown-simple" : "user"),
                    admin ? "You’re facilitating" : "You’re participating",
                  ],
                ),
              ],
            ),
          ],
        ),
        h.main(
          [h.Class("workspace")],
          [
            b.phase !== "closed"
              ? h.header(
                  [h.Class("board-header")],
                  [h.h1([h.Key(b.phase)], [titles[b.phase]])],
                )
              : null,
            h.div(
              [h.Class("board-tools")],
              [
                h.div(
                  [h.Class("presence")],
                  [
                    ...b.participants.slice(0, 6).map(avatar),
                    b.participants.length > 6
                      ? h.span(
                          [h.Class("avatar")],
                          [`+${b.participants.length - 6}`],
                        )
                      : null,
                  ],
                ),
                h.span(
                  [h.Class("connection")],
                  [
                    icon(m.connected ? "broadcast" : "wifi-slash"),
                    m.connected ? "Live" : "Reconnecting",
                  ],
                ),
                admin
                  ? button(
                      "People & invites",
                      Message.Invite(),
                      "quiet",
                      false,
                      "user-plus",
                    )
                  : null,
                b.phase === "actions"
                  ? button(
                      "Export",
                      Message.Export(),
                      "quiet",
                      false,
                      "download-simple",
                    )
                  : null,
              ],
            ),
            h.dialog(
              [
                h.Id("room-sheet"),
                h.Open(true),
                h.Class(
                  `room-sheet section-${m.roomSection} ${m.mobileMenu || m.invite || m.toolsOpen ? "sheet-active" : ""}`,
                ),
                h.AriaLabel("Room"),
              ],
              [
                h.div(
                  [h.Class("room-sheet-heading")],
                  [
                    h.h2([], ["Room"]),
                    h.button(
                      [
                        h.Type("button"),
                        h.Class("button quiet room-sheet-close"),
                        h.AriaLabel("Close room"),
                        h.OnClick(Message.CloseRoom()),
                      ],
                      [icon("x")],
                    ),
                  ],
                ),
                h.nav(
                  [h.Class("room-sheet-tabs"), h.AriaLabel("Room sections")],
                  (
                    [
                      "people",
                      ...(admin && b.phase !== "closed"
                        ? [
                            "timer",
                            ...(b.participants.some((p) => p.id !== m.actorId)
                              ? ["handover"]
                              : []),
                          ]
                        : []),
                    ] as const
                  ).map((section) =>
                    h.button(
                      [
                        h.Type("button"),
                        h.Class(
                          `button ${m.roomSection === section ? "primary" : "secondary"}`,
                        ),
                        h.AriaPressed(String(m.roomSection === section)),
                        h.OnClick(
                          Message.RoomSection({
                            section: Schema.decodeUnknownSync(
                              Schema.Literals(["people", "timer", "handover"]),
                            )(section),
                          }),
                        ),
                      ],
                      [
                        new Map([
                          ["people", "People"],
                          ["timer", "Timer"],
                          ["handover", "Handover"],
                        ]).get(section) ?? section,
                      ],
                    ),
                  ),
                ),
                !admin && m.mobileMenu
                  ? h.div(
                      [h.Class("room-sheet-people")],
                      b.participants.map((p) =>
                        h.p(
                          [],
                          [
                            p.name +
                              (p.id === b.adminId ? " · facilitator" : ""),
                          ],
                        ),
                      ),
                    )
                  : null,
                h.div(
                  [
                    h.Class(
                      `controls-surface ${m.toolsOpen && admin ? "is-open" : ""}`,
                    ),
                    ...(m.toolsOpen && admin
                      ? [h.Role("region"), h.AriaLabel("Facilitator controls")]
                      : []),
                  ],
                  [
                    h.div(
                      [h.Class("room-toolbar")],
                      [
                        b.phase !== "closed" &&
                        (admin || b.timer?.endsAt || b.timer?.remainingMs)
                          ? h.section(
                              [
                                h.Class(
                                  `room-timer ${m.toolsOpen && admin ? "controls-open" : ""}`,
                                ),
                                h.AriaLabel("Shared session timer"),
                              ],
                              [
                                h.div(
                                  [h.Class("timer-display")],
                                  [
                                    icon("timer"),
                                    b.timer?.endsAt || timerSeconds
                                      ? h.strong([], [timerText])
                                      : null,
                                    h.span(
                                      [],
                                      [
                                        b.timer?.endsAt
                                          ? timerSeconds
                                            ? "Time remaining"
                                            : "Time’s up · continue when ready"
                                          : timerSeconds
                                            ? "Paused"
                                            : "Timer",
                                      ],
                                    ),
                                  ],
                                ),
                                admin
                                  ? h.div(
                                      [h.Class("tool-buttons")],
                                      [
                                        !timerSeconds
                                          ? button(
                                              "5 min",
                                              tool("start", 300),
                                              "quiet",
                                            )
                                          : null,
                                        !timerSeconds
                                          ? button(
                                              "10 min",
                                              tool("start", 600),
                                              "quiet",
                                            )
                                          : null,
                                        b.timer?.endsAt && timerSeconds
                                          ? button(
                                              "Pause",
                                              tool("pause"),
                                              "secondary",
                                            )
                                          : timerSeconds
                                            ? button(
                                                "Resume",
                                                tool("resume"),
                                                "secondary",
                                              )
                                            : null,
                                        b.timer?.endsAt || timerSeconds
                                          ? button(
                                              "+1 min",
                                              tool("extend", 60),
                                              "quiet",
                                            )
                                          : null,
                                        b.timer?.endsAt || timerSeconds
                                          ? button(
                                              "Clear",
                                              tool("stop"),
                                              "quiet",
                                            )
                                          : null,
                                      ],
                                    )
                                  : null,
                              ],
                            )
                          : null,
                        admin && !m.toolsOpen && b.phase !== "closed"
                          ? h.div(
                              [
                                h.Class(
                                  `room-tools-toggle ${admin && canCombine && b.canUndoCombine ? "has-undo" : ""}`,
                                ),
                              ],
                              [
                                button(
                                  m.toolsOpen
                                    ? "Close room controls"
                                    : "Facilitator controls",
                                  Message.Tools(),
                                  "quiet",
                                  false,
                                  "gear",
                                ),
                              ],
                            )
                          : null,
                      ],
                    ),
                    m.toolsOpen && b.phase !== "closed"
                      ? h.div(
                          [h.Class("controls-close")],
                          [
                            button(
                              "Close controls",
                              Message.Tools(),
                              "quiet",
                              false,
                              "x",
                            ),
                          ],
                        )
                      : null,
                    m.toolsOpen && admin && b.phase !== "closed"
                      ? h.section(
                          [h.Class("room-tools"), h.AriaLabel("Room controls")],
                          [
                            h.div(
                              [],
                              [
                                h.h3([], ["Hand over facilitation"]),
                                h.p(
                                  [h.Class("subtle")],
                                  [
                                    "The selected teammate gets control immediately.",
                                  ],
                                ),
                                Select.view(
                                  {
                                    id: "handover-to",
                                    value: m.handoverTo,
                                    onChange: (value) =>
                                      Message.Field({
                                        field: "handoverTo",
                                        value,
                                      }),
                                    toView: (a) =>
                                      h.div(
                                        [h.Class("field")],
                                        [
                                          h.label(
                                            [...a.label],
                                            ["Next facilitator"],
                                          ),
                                          h.select(
                                            [...a.select],
                                            [
                                              h.option(
                                                [h.Value("")],
                                                ["Choose a teammate"],
                                              ),
                                              ...b.participants
                                                .filter(
                                                  (p) => p.id !== m.actorId,
                                                )
                                                .map((p) =>
                                                  h.option(
                                                    [h.Value(p.id)],
                                                    [p.name],
                                                  ),
                                                ),
                                            ],
                                          ),
                                        ],
                                      ),
                                  },
                                  h,
                                ),
                                button(
                                  "Hand over control",
                                  tool("handover"),
                                  "secondary",
                                  !m.handoverTo,
                                ),
                              ],
                            ),
                          ],
                        )
                      : null,
                  ],
                ),
                m.invite && admin
                  ? h.section(
                      [
                        h.Class("invitations-panel"),
                        h.AriaLabel("People and invitations"),
                      ],
                      [
                        h.div(
                          [h.Class("invitation-heading")],
                          [
                            h.h2([], ["People & invites"]),
                            button(
                              "Close",
                              Message.Invite(),
                              "quiet",
                              false,
                              "x",
                            ),
                          ],
                        ),
                        m.inviteLoading
                          ? h.p([h.Role("status")], ["Loading invitations…"])
                          : null,
                        m.inviteError
                          ? h.div(
                              [h.Role("alert")],
                              [
                                m.inviteError,
                                button(
                                  "Retry invitations",
                                  Message.RetryInvites(),
                                  "secondary",
                                ),
                              ],
                            )
                          : null,
                        h.p(
                          [h.Class("subtle")],
                          [
                            "Each person gets their own link. Share the room password separately.",
                          ],
                        ),
                        h.form(
                          [
                            h.Class("invitation-form"),
                            h.OnSubmit(Message.AddInvite()),
                          ],
                          [
                            field(
                              "inviteName",
                              "Participant name",
                              m.inviteName,
                              "e.g. Sam",
                            ),
                            button(
                              "Add participant",
                              Message.AddInvite(),
                              "primary",
                              !m.inviteName.trim() ||
                                m.busy ||
                                b.phase === "closed",
                              "user-plus",
                            ),
                          ],
                        ),
                        ...m.inviteLinks.map((p) =>
                          h.div(
                            [h.Class("invitation-row"), h.Key(p.id)],
                            [
                              h.div(
                                [],
                                [
                                  h.strong(
                                    [],
                                    [
                                      p.name +
                                        (p.id === m.actorId ? " (you)" : ""),
                                    ],
                                  ),
                                  h.span(
                                    [h.Class("subtle")],
                                    [
                                      b.participants.some(
                                        (person) => person.id === p.id,
                                      )
                                        ? "Joined"
                                        : "Invited",
                                    ],
                                  ),
                                ],
                              ),
                              Input.view(
                                {
                                  id: `invite-${p.id}`,
                                  value: p.url,
                                  isReadOnly: true,
                                  toView: (a) =>
                                    h.input([
                                      ...a.input,
                                      h.AriaLabel(
                                        `Personal link for ${p.name}`,
                                      ),
                                    ]),
                                },
                                h,
                              ),
                              h.button(
                                [
                                  h.Type("button"),
                                  h.Class("button secondary invite-copy"),
                                  h.AriaLabel(`Copy link for ${p.name}`),
                                  h.OnClick(Message.Copy({ url: p.url })),
                                ],
                                [icon("copy"), h.span([], ["Copy link"])],
                              ),
                            ],
                          ),
                        ),
                      ],
                    )
                  : null,

                (b.phase === "actions" || b.phase === "closed") &&
                (m.mobileMenu || m.invite || m.toolsOpen)
                  ? h.div(
                      [h.Class("room-sheet-export")],
                      [
                        button(
                          "Export",
                          Message.Export(),
                          "secondary",
                          false,
                          "download-simple",
                        ),
                      ],
                    )
                  : null,
              ],
            ),
            b.phase === "closed"
              ? h.section(
                  [h.Class("closed-summary")],
                  [
                    icon("check-circle"),
                    h.div(
                      [],
                      [
                        h.h1(
                          [],
                          [
                            b.archived
                              ? "Archived · read-only"
                              : "Retrospective complete",
                          ],
                        ),
                        h.p([h.Class("muted")], [
                          `Download before ${new Date(b.deletesAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}. This retro is then deleted automatically.`,
                        ]),
                        h.a(
                          [h.Href("/"), h.Class("home-link")],
                          ["Back to retrospectives", icon("arrow-right")],
                        ),
                        button(
                          `${b.actions.length} action ${b.actions.length === 1 ? "item" : "items"}${m.actionsOnly ? " · filtered" : ""}`,
                          Message.ToggleActions(),
                          "quiet action-count",
                          !b.actions.length,
                          "funnel",
                        ),
                      ],
                    ),
                    button(
                      "Download summary",
                      Message.Export(),
                      "primary",
                      false,
                      "download-simple",
                    ),
                    admin
                      ? button(
                          "Manage room",
                          Message.ManageRoom(),
                          "secondary",
                          false,
                          "gear",
                        )
                      : null,
                    admin && m.manageRoom
                      ? h.div(
                          [h.Class("cleanup-actions")],
                          [
                            button(
                              b.archived ? "Restore retro" : "Archive retro",
                              run(b.archived ? "restore" : "archive"),
                              "secondary",
                              m.busy,
                              "archive",
                            ),
                            h.p(
                              [h.Class("subtle")],
                              [
                                b.archived
                                  ? "Read-only until restored."
                                  : "Archiving makes the room read-only. You can restore it later.",
                              ],
                            ),
                            button(
                              "Delete retro…",
                              Message.Cleanup(),
                              "secondary",
                              m.busy,
                              "trash",
                            ),
                            m.cleanup
                              ? h.section(
                                  [
                                    h.Class("cleanup-confirm"),
                                    h.AriaLabel("Delete retro permanently"),
                                  ],
                                  [
                                    h.h3(
                                      [],
                                      ["Permanently delete this retro?"],
                                    ),
                                    h.p(
                                      [],
                                      [
                                        "This removes all notes, votes and actions for everyone. The room link will stop working. There is no undo.",
                                      ],
                                    ),
                                    h.p(
                                      [],
                                      [
                                        "Download the summary first and check that the file is saved before continuing.",
                                      ],
                                    ),
                                    button(
                                      "Download summary",
                                      Message.Export(),
                                      "secondary",
                                      false,
                                      "download-simple",
                                    ),
                                    field(
                                      "deleteTitle",
                                      `Type “${b.title}” to confirm`,
                                      m.deleteTitle,
                                    ),
                                    button(
                                      m.busy
                                        ? "Deleting…"
                                        : "Permanently delete",
                                      Message.DeleteRoom(),
                                      "danger",
                                      m.busy || m.deleteTitle !== b.title,
                                      "trash",
                                    ),
                                    button(
                                      "Cancel",
                                      Message.Cleanup(),
                                      "secondary",
                                      m.busy,
                                    ),
                                  ],
                                )
                              : null,
                          ],
                        )
                      : null,
                  ],
                )
              : null,
            feedback(),
            b.phase === "vote"
              ? h.p(
                  [h.Class("voting-progress"), h.Role("status")],
                  [
                    availableVotes(b) === 0
                      ? "There are no notes to vote on."
                      : `${b.voters.length} of ${b.participants.length} people have finished voting`,
                  ],
                )
              : null,
            !m.connected
              ? button(
                  "Reconnect",
                  Message.Retry(),
                  "secondary",
                  false,
                  "arrows-clockwise",
                )
              : null,
            h.div(
              [h.Class("board-navigation")],
              [
                resultsVisible && m.actionsOnly
                  ? button(
                      "Show all notes",
                      Message.ToggleActions(),
                      "secondary action-filter-reset",
                      Boolean(selected),
                      "x",
                    )
                  : null,
                resultsVisible
                  ? Select.view(
                      {
                        id: "vote-sort",
                        value: m.voteSort,
                        onChange: (value) =>
                          Message.VoteSort({
                            order: Match.value(value).pipe(
                              Match.when("lowest", () => "lowest" as const),
                              Match.when("original", () => "original" as const),
                              Match.orElse(() => "highest" as const),
                            ),
                          }),
                        toView: (a) =>
                          h.div(
                            [h.Class("sort-control")],
                            [
                              h.label([...a.label], ["Sort by"]),
                              icon("sort-descending"),
                              h.select(
                                [...a.select],
                                [
                                  h.option(
                                    [h.Value("highest")],
                                    ["Most votes first"],
                                  ),
                                  h.option(
                                    [h.Value("lowest")],
                                    ["Fewest votes first"],
                                  ),
                                  h.option(
                                    [h.Value("original")],
                                    ["Original order"],
                                  ),
                                ],
                              ),
                            ],
                          ),
                      },
                      h,
                    )
                  : null,
                m.screen === "board"
                  ? h.nav(
                      [h.Class("column-tabs"), h.AriaLabel("Note columns")],
                      columns.map((c) =>
                        h.button(
                          [
                            h.Class(
                              `${c.tone} ${m.mobileColumn === c.id ? "active" : ""}`,
                            ),
                            h.OnClick(Message.MobileColumn({ column: c.id })),
                            h.AriaPressed(String(m.mobileColumn === c.id)),
                          ],
                          [
                            icon(c.icon),
                            c.title,
                            h.span([], [String(columnCount(c.id))]),
                          ],
                        ),
                      ),
                    )
                  : null,
              ],
            ),
            h.div(
              [h.Class(`board category-${m.categoryDirection}`)],
              columns.map((c) => {
                const notes = sortByVotes(
                  visibleNotes.filter((n) => n.column === c.id),
                  resultsVisible ? m.voteSort : "original",
                  (n) => score(n.id),
                );

                const hidden = Math.max(0, (b.tally[c.id] ?? 0) - notes.length);

                return h.section(
                  [
                    h.Class(
                      `column ${c.tone} ${m.mobileColumn === c.id ? "mobile-active" : ""}`,
                    ),
                    h.AriaLabel(c.title),
                  ],
                  [
                    h.div(
                      [h.Class("column-header")],
                      [
                        h.div(
                          [h.Class("column-title")],
                          [
                            h.h2([], [icon(c.icon), c.title]),
                            h.span(
                              [h.Class("count")],
                              [String(columnCount(c.id))],
                            ),
                          ],
                        ),
                        writing
                          ? h.h1(
                              [h.Class("mobile-composer-heading")],
                              [
                                h.span(
                                  [h.Class("category-stamp")],
                                  [icon(c.icon)],
                                ),
                                h.span(
                                  [],
                                  [writingPrompts.get(c.title) ?? c.title],
                                ),
                              ],
                            )
                          : null,
                        writing ? h.p([], [c.description]) : null,
                      ],
                    ),
                    writing &&
                    !me?.ready &&
                    (m.editor === c.id ||
                      (!m.editor && m.mobileColumn === c.id))
                      ? h.form(
                          [
                            h.Class(
                              `note-editor ${!m.editor ? "automatic-composer" : ""}`,
                            ),
                            h.OnSubmit(run("save")),
                          ],
                          [
                            h.div(
                              [h.Class("composer-sheet")],
                              [
                                h.span(
                                  [h.Class("composer-icon")],
                                  [icon(c.icon)],
                                ),
                                textarea(
                                  "draft",
                                  `Your ${c.title} note`,
                                  m.draft,
                                  "What’s on your mind?",
                                ),
                              ],
                            ),
                            h.div(
                              [h.Class("editor-actions")],
                              [
                                h.p(
                                  [h.Class("composer-privacy")],
                                  [icon("lock-simple"), "Private until reveal"],
                                ),
                                m.editId || m.draft
                                  ? button(
                                      "Cancel",
                                      Message.CancelEdit(),
                                      "quiet",
                                    )
                                  : null,
                                m.editId
                                  ? button(
                                      "Delete",
                                      run("delete", m.editId),
                                      "danger-quiet",
                                      false,
                                      "trash",
                                    )
                                  : null,
                                button(
                                  m.busy
                                    ? "Saving…"
                                    : m.editId
                                      ? "Save changes"
                                      : "Add note",
                                  run("save"),
                                  "primary",
                                  !m.draft.trim(),
                                  m.editId ? "check" : "plus",
                                ),
                              ],
                            ),
                          ],
                        )
                      : writing && !me?.ready
                        ? button(
                            "Add a note",
                            Message.MobileColumn({ column: c.id }),
                            "add-note",
                            false,
                            "plus",
                          )
                        : null,
                    h.div(
                      [h.Class("notes")],
                      [
                        ...notes.map((n) =>
                          h.article(
                            [
                              h.Class(
                                `note ${m.selected === n.id ? "selected" : ""} ${m.dragSource === n.id ? "is-dragging" : ""} ${m.dropTarget === n.id ? "drop-target" : ""}`,
                              ),
                              h.Key(n.id),
                              h.Id(`note-${n.id}`),
                              ...(canCombine && !m.busy
                                ? [
                                    h.Draggable(true),
                                    h.Tabindex(0),
                                    h.AriaLabel(
                                      `${n.text}. Press Space to pick up, arrow keys to choose a destination, Enter to combine, Escape to cancel.`,
                                    ),
                                    h.OnDragStart(
                                      Message.DragStart({ id: n.id }),
                                    ),
                                    h.OnDragEnd(Message.DragEnd()),
                                    h.AllowDrop(),
                                    h.OnDragEnter(
                                      Message.DragOver({ id: n.id }),
                                    ),
                                    h.OnDragOver(
                                      Message.DragOver({ id: n.id }),
                                    ),
                                    h.OnDragLeave(Message.DragOver({ id: "" })),
                                    h.OnDrop(Message.Drop({ id: n.id })),
                                  ]
                                : []),
                            ],
                            [
                              ...(n.parts
                                ? n.parts.map((part) =>
                                    h.div(
                                      [h.Class("combined-part")],
                                      [
                                        h.p(
                                          [h.Class("note-text")],
                                          [part.text],
                                        ),
                                        h.span(
                                          [h.Class("subtle")],
                                          [
                                            b.participants.find(
                                              (p) => p.id === part.authorId,
                                            )?.name ?? "Teammate",
                                          ],
                                        ),
                                      ],
                                    ),
                                  )
                                : [h.p([h.Class("note-text")], [n.text])]),
                              h.div(
                                [h.Class("note-footer")],
                                [
                                  writing
                                    ? null
                                    : h.span(
                                        [h.Class("subtle")],
                                        [
                                          n.parts
                                            ? `${n.parts.length} combined notes`
                                            : (b.participants.find(
                                                (p) => p.id === n.authorId,
                                              )?.name ?? "Teammate"),
                                        ],
                                      ),
                                  writing && !me?.ready
                                    ? button(
                                        "Edit",
                                        Message.Edit({
                                          column: c.id,
                                          id: n.id,
                                          text: n.text,
                                        }),
                                        "icon-button",
                                        false,
                                        "pencil-simple",
                                      )
                                    : null,
                                  b.phase === "vote"
                                    ? h.button(
                                        [
                                          h.Class(
                                            `button vote ${m.private.votes.includes(n.id) ? "selected-vote" : ""}`,
                                          ),
                                          h.AriaPressed(
                                            String(
                                              m.private.votes.includes(n.id),
                                            ),
                                          ),
                                          h.AriaLabel(
                                            `${m.private.votes.includes(n.id) ? "Remove vote from" : "Vote for"}: ${n.text}`,
                                          ),
                                          h.Disabled(
                                            !m.private.votes.includes(n.id) &&
                                              m.private.votes.length >=
                                                availableVotes(b),
                                          ),
                                          h.AriaBusy(m.pendingVote === n.id),
                                          h.OnClick(
                                            run(
                                              "vote",
                                              n.id,
                                              !m.private.votes.includes(n.id),
                                            ),
                                          ),
                                        ],
                                        [
                                          icon(
                                            m.private.votes.includes(n.id)
                                              ? "check"
                                              : "plus",
                                          ),
                                          m.pendingVote === n.id
                                            ? "Saving…"
                                            : m.private.votes.includes(n.id)
                                              ? "Voted"
                                              : "Vote",
                                        ],
                                      )
                                    : null,
                                  b.phase === "actions" || b.phase === "closed"
                                    ? h.span(
                                        [h.Class("vote-score")],
                                        [
                                          icon("hand-pointing"),
                                          `${score(n.id)} ${score(n.id) === 1 ? "vote" : "votes"}`,
                                        ],
                                      )
                                    : null,
                                  admin &&
                                  b.phase === "actions" &&
                                  m.selected !== n.id
                                    ? button(
                                        "Add action",
                                        Message.Select({ id: n.id }),
                                        "icon-button",
                                        false,
                                        "list-plus",
                                      )
                                    : null,
                                ],
                              ),
                              canCombine && n.parts
                                ? button(
                                    "Split notes",
                                    Message.Split({ id: n.id }),
                                    "icon-button",
                                    m.busy,
                                    "arrows-out",
                                  )
                                : null,
                              ...b.actions
                                .filter((a) => a.noteId === n.id)
                                .map((a) =>
                                  m.actionId === a.id && admin
                                    ? actionForm
                                    : h.div(
                                        [h.Class("card-action"), h.Key(a.id)],
                                        [
                                          h.div(
                                            [],
                                            [
                                              h.strong([], [a.text]),
                                              h.p(
                                                [h.Class("subtle")],
                                                [
                                                  b.participants.find(
                                                    (p) => p.id === a.ownerId,
                                                  )?.name ?? "Unassigned",
                                                  a.dueDate
                                                    ? ` · ${new Date(a.dueDate + "T12:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                                                    : "",
                                                ],
                                              ),
                                            ],
                                          ),
                                          admin && b.phase === "actions"
                                            ? h.div(
                                                [h.Class("action-controls")],
                                                [
                                                  button(
                                                    "Edit action",
                                                    Message.EditAction({
                                                      id: a.id,
                                                    }),
                                                    "icon-button",
                                                    m.busy,
                                                    "pencil-simple",
                                                  ),
                                                  button(
                                                    "Delete action",
                                                    run("deleteAction", a.id),
                                                    "icon-button",
                                                    m.busy,
                                                    "trash",
                                                  ),
                                                ],
                                              )
                                            : null,
                                        ],
                                      ),
                                ),
                              m.selected === n.id && !m.actionId
                                ? actionForm
                                : null,
                            ],
                          ),
                        ),
                        writing && hidden > 0
                          ? h.div(
                              [h.Class("hidden-notes")],
                              [
                                icon("lock-simple"),
                                `${hidden} private ${hidden === 1 ? "note" : "notes"} from others`,
                              ],
                            )
                          : null,
                        !notes.length && !writing
                          ? h.p(
                              [h.Class("empty-column")],
                              [
                                m.actionsOnly
                                  ? "No actions in this category"
                                  : "No notes",
                              ],
                            )
                          : null,
                      ],
                    ),
                  ],
                );
              }),
            ),
          ],
        ),
        h.footer(
          [h.Class("session-footer")],
          [
            h.div(
              [h.Class("footer-summary")],
              [
                b.phase === "actions"
                  ? button(
                      `${b.actions.length} action ${b.actions.length === 1 ? "item" : "items"}${m.actionsOnly ? " · filtered" : ""}`,
                      Message.ToggleActions(),
                      "quiet action-count",
                      Boolean(selected) || !b.actions.length,
                      "funnel",
                    )
                  : h.strong(
                      [],
                      [
                        writing
                          ? `${ready} of ${b.participants.length} ready`
                          : b.phase === "vote"
                            ? `${m.private.votes.length} of ${availableVotes(b)} votes used`
                            : b.phase === "closed"
                              ? b.archived
                                ? "Archived · read-only"
                                : "Session complete"
                              : "All notes revealed",
                      ],
                    ),
              ],
            ),
            writing
              ? h.div(
                  [h.Class("ready-people")],
                  b.participants
                    .slice(0, 6)
                    .map((p, i) =>
                      h.div(
                        [h.Class("ready-person")],
                        [
                          avatar(p, i),
                          h.span(
                            [h.Class(p.ready ? "ready-label" : "subtle")],
                            [p.ready ? "Ready" : "Writing"],
                          ),
                        ],
                      ),
                    ),
                )
              : h.div([h.Class("footer-spacer")]),
            h.div(
              [h.Class("footer-actions")],
              [
                writing
                  ? button(
                      me?.ready ? "Keep writing" : "Done writing",
                      run("ready", "", !me?.ready),
                      "secondary",
                      Boolean(m.draft.trim()) ||
                        Object.values(m.drafts).some((draft) => draft.trim()),
                      "check",
                    )
                  : null,
                b.phase === "vote"
                  ? button(
                      b.voters.includes(m.actorId)
                        ? "Change votes"
                        : "Done voting",
                      run("votingDone", "", !b.voters.includes(m.actorId)),
                      "secondary",
                      m.busy,
                      "check",
                    )
                  : null,
                admin && primary
                  ? button(
                      primary.label,
                      Message.Confirm({ op: primary.op }),
                      "primary",
                      m.busy || Boolean(selected),
                      primary.icon,
                    )
                  : null,
              ],
            ),
          ],
        ),
        m.confirm && primary && !(b.phase === "actions" && selected)
          ? h.div(
              [
                h.Class("confirm-bar"),
                h.Role("region"),
                h.AriaLabel("Confirm next phase"),
              ],
              [
                h.div(
                  [],
                  [
                    h.strong([], [primary.label + "?"]),
                    h.p([], [phaseConfirmation(b, m.confirm)]),
                  ],
                ),
                button("Not yet", Message.Confirm({ op: "" }), "secondary"),
                button(primary.label, run(primary.op), "primary"),
              ],
            )
          : null,
      ],
    ),
  };
};
