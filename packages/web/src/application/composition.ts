import { Update } from "foldkit";
import { grantParticipant } from "@retro/domain/Room/Access";
import { columnsFor } from "@retro/domain/Room/Templates";
import type { BoardState } from "@retro/domain/Room/Values";
import { NavigationBlock } from "../features/Navigation.ts";
import { NoticeBlock } from "../features/Notice.ts";
import { SessionControlsBlock } from "../features/SessionControls.ts";
import { CombiningBlock } from "../features/Combining.ts";
import { LifecycleBlock } from "../features/Lifecycle.ts";
import { NotesBlock } from "../features/Notes.ts";
import { ActionEditorBlock } from "../features/ActionEditor.ts";
import { EntryBlock } from "../features/Entry.ts";
import { TimerBlock } from "../features/Timer.ts";
import { HandoverBlock } from "../features/Handover.ts";
import { InvitationsBlock } from "../features/Invitations.ts";
import { EnterRoomViewport } from "./command.ts";
import { ApplicationDefinition, type Model } from "./definition.ts";

export const isWorking = (m: Model) =>
  m.notes.busy ||
  m.actionEditor.busy ||
  m.combining.busy ||
  m.sessionControls.busy ||
  m.lifecycle.busy ||
  m.timer.busy ||
  m.handover.busy ||
  m.invitations.busy;

export const invitationContext = (m: Model) => ({
  roomId: m.roomId,
  allowed: m.board?.adminId === m.actorId,
  closed: m.board?.phase === "closed",
});

export const actionContext = (m: Model) => ({
  roomId: m.roomId,
  board: m.board,
  actorId: m.actorId,
  busy: isWorking(m),
});

export const notesContext = (m: Model) => ({
  ...actionContext(m),
  column: m.navigation.mobileColumn,
});

export const combiningContext = actionContext;

export const lifecycleContext = (m: Model) => ({
  ...actionContext(m),
  voteSort: m.navigation.voteSort,
});

export const navigationContext = (m: Model) => ({
  board: m.board,
  private: m.private,
  busy: isWorking(m),
  editingAction: Boolean(m.actionEditor.selected),
  editingNote: m.notes.editId ? m.notes.editor : null,
});

export const sessionControlsContext = (m: Model) => ({
  ...actionContext(m),
  private: m.private,
  unsavedNotes:
    Boolean(m.notes.draft.trim()) ||
    Object.values(m.notes.drafts).some((d) => Boolean(d.trim())),
  editingAction: Boolean(m.actionEditor.selected),
  actionsOnly: m.navigation.actionsOnly,
});

const facilitationContext = (m: Model) => ({
  roomId: m.roomId,
  allowed: m.board?.adminId === m.actorId && m.board?.phase !== "closed",
  busy: isWorking(m),
});

const reportError = (reason: string) =>
  ApplicationDefinition.makeFieldsStep(() => ({ error: () => reason }));

export const NoticeBinding = ApplicationDefinition.makeBinding(NoticeBlock, {
  field: "notice",
});

// Stage the reciprocal Notes ↔ Navigation policy against the unselected binding.
// The selected binding below retains this identity and owns the generated route.
export const NavigationBinding = ApplicationDefinition.makeBinding(
  NavigationBlock,
  {
    field: "navigation",
    delivery: { toUpdateContext: (m) => [navigationContext(m)] },
  },
);

export const NotesBinding = ApplicationDefinition.makeBinding(NotesBlock, {
  field: "notes",
  delivery: { toUpdateContext: (m) => [notesContext(m)] },
}).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(NotesBlock, {
    Saved: () => reportError(""),
    Notified: ({ text }) =>
      Update.combineSteps([
        reportError(""),
        NoticeBinding.informNotice({ text }),
      ]),
    Failed: ({ reason }) => reportError(reason),
    Editing: ({ column }) =>
      ApplicationDefinition.makeStep((m) =>
        Update.combineSteps([
          reportError(""),
          NavigationBinding.focusColumn({ column }, navigationContext(m)),
        ]),
      ),
  }),
});

const NavigationBindingWithOutMessagePolicy =
  NavigationBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(NavigationBlock, {
      Notified: ({ text }) => NoticeBinding.informNotice({ text }),
      Selected: ({ column }) =>
        ApplicationDefinition.makeStep((m) =>
          NotesBinding.informColumn({ column }, notesContext(m)),
        ),
    }),
  });

export const ActionEditorBinding = ApplicationDefinition.makeBinding(
  ActionEditorBlock,
  {
    field: "actionEditor",
    delivery: { toUpdateContext: (m) => [actionContext(m)] },
  },
).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(ActionEditorBlock, {
    Notified: ({ text }) => NoticeBinding.informNotice({ text }),
    Failed: ({ reason }) => reportError(reason),
  }),
});

export const SessionControlsBinding = ApplicationDefinition.makeBinding(
  SessionControlsBlock,
  {
    field: "sessionControls",
    delivery: { toUpdateContext: (m) => [sessionControlsContext(m)] },
  },
).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(SessionControlsBlock, {
    Completed: () => reportError(""),
    Failed: ({ reason }) => reportError(reason),
    Voted: ({ state }) =>
      ApplicationDefinition.makeFieldsStep((m) => ({
        private: () => state ?? m.private,
        error: () => "",
      })),
    ToggleActions: () =>
      ApplicationDefinition.makeStep((m) =>
        NavigationBinding.toggleActions(navigationContext(m)),
      ),
  }),
});

export const InvitationsBinding = ApplicationDefinition.makeBinding(
  InvitationsBlock,
  {
    field: "invitations",
    delivery: { toUpdateContext: (m) => [invitationContext(m)] },
  },
).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(InvitationsBlock, {
    Closed: () =>
      ApplicationDefinition.makeFieldsStep(() => ({
        invite: () => false,
        mobileMenu: () => false,
      })),
    Notified: ({ text }) => NoticeBinding.informNotice({ text }),
  }),
});

// All incoming room snapshots use the same coordination step, whether from the
// live view or a command receipt. Each feature decides what to invalidate itself.
export const receiveBoard = (board: BoardState | null) =>
  ApplicationDefinition.makeStep((m) => {
    const next = { ...m, board };

    const text =
      m.board && board && m.board.adminId !== board.adminId
        ? board.adminId === m.actorId
          ? "You are now the facilitator."
          : `${board.participants.find((p) => p.id === board.adminId)?.name ?? "A teammate"} is now facilitating.`
        : m.notice.text;

    return Update.combineSteps([
      ApplicationDefinition.makeFieldsStep(() => ({
        board: () => board,
        connected: () => true,
        error: () => (m.connected ? m.error : ""),
        roomSection: () =>
          board?.adminId === m.actorId ? m.roomSection : "people",
        toolsOpen: () => board?.adminId === m.actorId && m.toolsOpen,
      })),
      NoticeBinding.informNotice({ text }),
      NavigationBinding.informRoom(navigationContext(next)),
      ActionEditorBinding.informRoomChange(actionContext(next)),
      NotesBinding.informRoom({ load: false }, notesContext(next)),
      CombiningBinding.informRoom(combiningContext(next)),
      SessionControlsBinding.informRoom(sessionControlsContext(next)),
    ]);
  });

export const CombiningBinding = ApplicationDefinition.makeBinding(
  CombiningBlock,
  {
    field: "combining",
    delivery: { toUpdateContext: (m) => [combiningContext(m)] },
  },
);

const CombiningBindingWithOutMessagePolicy =
  CombiningBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(CombiningBlock, {
      Updated: ({ board, noteId, notice }) =>
        ApplicationDefinition.makeStep((m) =>
          Update.combineSteps([
            ...(board ? [receiveBoard(board)] : []),
            NavigationBinding.focusColumn(
              {
                column:
                  board?.notes.find((n) => n.id === noteId)?.column ??
                  m.navigation.mobileColumn,
              },
              navigationContext(m),
            ),
            reportError(""),
            NoticeBinding.informNotice({ text: notice }),
          ]),
        ),
      Failed: ({ reason }) => reportError(reason),
    }),
  });

export const TimerBinding = ApplicationDefinition.makeBinding(TimerBlock, {
  field: "timer",
  delivery: { toUpdateContext: (m) => [facilitationContext(m)] },
  subscriptions: {
    when: (m) =>
      Boolean(
        m.entered && m.board?.timer?.endsAt && m.board.phase !== "closed",
      ),
  },
}).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(TimerBlock, {
    Updated: ({ board, notice }) =>
      Update.combineSteps([
        ...(board ? [receiveBoard(board)] : []),
        NoticeBinding.informNotice({ text: notice }),
      ]),
    Failed: ({ reason }) => reportError(reason),
  }),
});

export const HandoverBinding = ApplicationDefinition.makeBinding(
  HandoverBlock,
  {
    field: "handover",
    delivery: { toUpdateContext: (m) => [facilitationContext(m)] },
  },
).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(HandoverBlock, {
    Updated: ({ board, notice }) =>
      Update.combineSteps([
        ...(board ? [receiveBoard(board)] : []),
        NoticeBinding.informNotice({ text: notice }),
      ]),
    Failed: ({ reason }) => reportError(reason),
  }),
});

export const markUnavailable = ApplicationDefinition.makeStep((m) =>
  Update.combineSteps([
    ApplicationDefinition.makeFieldsStep(() => ({
      unavailable: () => true,
      entered: () => false,
      connected: () => false,
      board: () => null,
    })),
    NotesBinding.informRoom(
      { load: false },
      { ...notesContext(m), board: null },
    ),
  ]),
);

export const LifecycleBinding = ApplicationDefinition.makeBinding(
  LifecycleBlock,
  {
    field: "lifecycle",
    delivery: { toUpdateContext: (m) => [lifecycleContext(m)] },
  },
).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(LifecycleBlock, {
    Notified: ({ text }) => NoticeBinding.informNotice({ text }),
    Failed: ({ reason }) => reportError(reason),
    Deleted: () => markUnavailable,
    ToggleActions: () =>
      ApplicationDefinition.makeStep((m) =>
        NavigationBinding.toggleActions(navigationContext(m)),
      ),
  }),
});

export const acceptRoom = (
  msg: ReturnType<typeof EntryBlock.OutMessage.Entered>,
) =>
  ApplicationDefinition.makeStep((m) => {
    const actorId = grantParticipant(msg.board.grants, m.sessionId) ?? "";

    const column = columnsFor(msg.board.template).some(
      (c) => c.id === m.navigation.mobileColumn,
    )
      ? m.navigation.mobileColumn
      : columnsFor(msg.board.template)[0]!.id;

    return Update.combineSteps([
      () => ({
        model: {
          ...m,
          roomId: msg.roomId,
          actorId,
          invite: !m.roomId || m.invite,
          entered: true,
          error: "",
        } satisfies Model,
        commands: m.entered ? [] : [EnterRoomViewport()],
      }),
      receiveBoard(msg.board),
      InvitationsBinding.informLinks(
        {
          links: msg.links ?? m.invitations.links,
          error:
            !m.roomId && !msg.links
              ? "Could not load invitations. Please retry."
              : "",
        },
        {
          roomId: msg.roomId,
          allowed: msg.board.adminId === actorId,
          closed: msg.board.phase === "closed",
        },
      ),
      NotesBinding.informRoom(
        { load: !m.entered },
        {
          ...notesContext(m),
          roomId: msg.roomId,
          board: msg.board,
          actorId,
          column,
        },
      ),
    ]);
  });

export const EntryBinding = ApplicationDefinition.makeBinding(EntryBlock, {
  field: "entry",
  presentWhen: (m) => !m.entered,
  init: { contextToArgs: (f) => [f] },
}).withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(EntryBlock, {
    Entered: (msg) => acceptRoom(msg),
    Unavailable: () => markUnavailable,
  }),
});

export const ApplicationComposition = ApplicationDefinition.makeComposition({
  bindings: [
    EntryBinding,
    InvitationsBinding,
    TimerBinding,
    HandoverBinding,
    NavigationBindingWithOutMessagePolicy,
    NotesBinding,
    ActionEditorBinding,
    SessionControlsBinding,
    CombiningBindingWithOutMessagePolicy,
    LifecycleBinding,
    NoticeBinding,
  ],
});
