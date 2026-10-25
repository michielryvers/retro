import { grantParticipant } from "@retro/domain/Room/Access";
import * as Match from "effect/Match";
import { columnsFor } from "@retro/domain/Room/Templates";
import {
  Enter,
  Resume,
  Facilitate,
  Combine,
  Mutate,
  EnterRoomViewport,
  FocusMerge,
  FocusControl,
  FocusAction,
  LoadInvitations,
  Copy,
  DeleteRetro,
  Export,
} from "./command.ts";
import { Model } from "./definition.ts";
import { ApplicationComposition } from "./composition.ts";

export const update = ApplicationComposition.makeUpdate((m, msg) => {
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
        model: { ...m, showPassword: !m.showPassword } satisfies Model,
      }),
      RoomUnavailable: () => ({
        model: {
          ...m,
          unavailable: true,
          entered: false,
          connected: false,
          busy: false,
          board: null,
        } satisfies Model,
      }),
      ClearNotice: (msg) => ({
        model: {
          ...m,
          notice: m.notice === msg.text ? "" : m.notice,
        } satisfies Model,
      }),
      InvitesFailed: (msg) => ({
        model: {
          ...m,
          inviteLoading: false,
          busy: false,
          inviteError: msg.reason,
        } satisfies Model,
      }),
      RetryInvites: () => ({
        model: { ...m, inviteLoading: true, inviteError: "" } satisfies Model,
        commands: [LoadInvitations({ roomId: m.roomId, name: "" })],
      }),
      CloseRoom: () => ({
        model: {
          ...m,
          mobileMenu: false,
          invite: false,
          toolsOpen: false,
        } satisfies Model,
      }),
      MobileMenu: () => ({
        model: {
          ...m,
          mobileMenu: true,
          roomSection: "people",
          invite: m.board?.adminId === m.actorId,
          toolsOpen: false,
        } satisfies Model,
        commands:
          m.board?.adminId === m.actorId
            ? [LoadInvitations({ roomId: m.roomId, name: "" })]
            : [],
      }),
      RoomSection: (msg) => ({
        model: {
          ...m,
          roomSection: msg.section,
          mobileMenu: true,
          invite: msg.section === "people" && m.board?.adminId === m.actorId,
          toolsOpen: msg.section !== "people",
        } satisfies Model,
        commands:
          msg.section === "people" && m.board?.adminId === m.actorId
            ? [LoadInvitations({ roomId: m.roomId, name: "" })]
            : [],
      }),
      Split: (msg) =>
        m.busy || m.board?.phase !== "reveal" || m.board.adminId !== m.actorId
          ? { model: m }
          : {
              model: {
                ...m,
                busy: true,
                error: "",
                selected: "",
              } satisfies Model,
              commands: [
                Facilitate({
                  roomId: m.roomId,
                  action: "split",
                  seconds: 0,
                  value: msg.id,
                }),
              ],
            },
      Tools: () => ({
        model: {
          ...m,
          toolsOpen: !m.toolsOpen,
          mobileMenu: false,
          invite: false,
          roomSection: "timer",
        } satisfies Model,
        commands: [
          FocusControl({
            selector: m.toolsOpen
              ? ".mobile-menu-button, .room-tools-toggle button"
              : ".controls-surface .controls-close button",
          }),
        ],
      }),
      Tick: (msg) => ({ model: { ...m, now: msg.now } satisfies Model }),
      Tool: (msg) =>
        m.busy
          ? { model: m }
          : {
              model: {
                ...m,
                busy: true,
                error: "",
                notice: "",
              } satisfies Model,
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
        } satisfies Model,
      }),
      DragStart: (msg) => {
        return {
          model: {
            ...m,
            dragSource: m.busy ? "" : msg.id,
            dropTarget: "",
          } satisfies Model,
        };
      },
      DragEnd: () => {
        return {
          model: { ...m, dragSource: "", dropTarget: "" } satisfies Model,
        };
      },
      DragOver: (msg) => {
        return {
          model: {
            ...m,
            dropTarget: m.dragSource && m.dragSource !== msg.id ? msg.id : "",
          } satisfies Model,
        };
      },
      Drop: (msg) => {
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
          } satisfies Model,
          commands: [
            Combine({
              roomId: m.roomId,
              sourceId: m.dragSource,
              targetId: msg.id,
            }),
          ],
        };
      },
      MergePick: (msg) => {
        return {
          model: {
            ...m,
            mergeSource: msg.id,
            mergeTarget: "",
            error: "",
            notice: "",
          } satisfies Model,
          commands: [FocusMerge()],
        };
      },
      MergeTarget: (msg) => {
        return { model: { ...m, mergeTarget: msg.id } satisfies Model };
      },
      MergeCancel: () => {
        return {
          model: {
            ...m,
            mergeSource: "",
            mergeTarget: "",
            dragSource: "",
            dropTarget: "",
          } satisfies Model,
        };
      },
      MergeConfirm: () => {
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
          model: { ...m, busy: true, error: "" } satisfies Model,
          commands: [
            Combine({
              roomId: m.roomId,
              sourceId: m.mergeSource,
              targetId: m.mergeTarget,
            }),
          ],
        };
      },
      Combined: (msg) => {
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
          } satisfies Model,
        };
      },
      Template: (msg) => {
        return { model: { ...m, template: msg.template } satisfies Model };
      },
      Screen: (msg) => {
        return {
          model: { ...m, screen: msg.screen, selected: "" } satisfies Model,
        };
      },
      ToggleActions: () => {
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
          } satisfies Model,
        };
      },
      VoteSort: (msg) => {
        return { model: { ...m, voteSort: msg.order } satisfies Model };
      },
      MobileColumn: (msg) => {
        if (m.busy || msg.column === m.mobileColumn) return { model: m };

        if (m.selected)
          return {
            model: {
              ...m,
              notice: "Save or cancel this action before switching categories.",
            } satisfies Model,
          };

        if (m.editId && m.editor !== msg.column)
          return {
            model: {
              ...m,
              notice: "Save or cancel your edit before switching categories.",
            } satisfies Model,
          };

        return {
          model: {
            ...m,
            mobileColumn: msg.column,
            draft: m.drafts[msg.column] ?? "",
            categoryDirection:
              columnsFor(m.board?.template).findIndex(
                (column) => column.id === msg.column,
              ) >
              columnsFor(m.board?.template).findIndex(
                (column) => column.id === m.mobileColumn,
              )
                ? "next"
                : "previous",
            editor: m.editor ? msg.column : null,
          } satisfies Model,
        };
      },
      VoteSaved: (msg) => {
        return {
          model: {
            ...m,
            busy: false,
            pendingVote: "",
            private: msg.state ?? m.private,
          } satisfies Model,
        };
      },
      Field: (msg) => {
        if (m.busy) return { model: m };

        if (msg.field === "draft" && !m.editId)
          return {
            model: {
              ...m,
              draft: msg.value,
              drafts: { ...m.drafts, [m.editor ?? m.mobileColumn]: msg.value },
            } satisfies Model,
          };

        return { model: { ...m, [msg.field]: msg.value } satisfies Model };
      },
      NeedsJoin: () => {
        return { model: { ...m, busy: false } satisfies Model };
      },
      Enter: () => {
        if (m.busy) return { model: m };

        return {
          model: { ...m, busy: true, error: "" } satisfies Model,
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
      Entered: (msg) => {
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
          } satisfies Model,
          commands: m.entered ? [] : [EnterRoomViewport()],
        };
      },
      Board: (msg) => {
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
          } satisfies Model,
        };
      },
      Private: (msg) => {
        return {
          model: {
            ...m,
            private: msg.state ?? { notes: [], votes: [], sessions: [] },
          } satisfies Model,
        };
      },
      Failed: (msg) => {
        if (msg.reason.includes("permanently deleted"))
          return {
            model: {
              ...m,
              unavailable: true,
              entered: false,
              connected: false,
              busy: false,
              board: null,
            } satisfies Model,
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
          } satisfies Model,
        };
      },
      WatchFailed: (msg) => {
        return {
          model: { ...m, connected: false, error: msg.reason } satisfies Model,
          commands: m.roomId
            ? [Resume({ roomId: m.roomId, invitation: true })]
            : [],
        };
      },
      Edit: (msg) => {
        if (m.busy) return { model: m };

        if (m.editId && m.editId !== msg.id)
          return {
            model: {
              ...m,
              notice: "Save or cancel your edit before opening another note.",
            } satisfies Model,
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
          } satisfies Model,
        };
      },
      CancelEdit: () => {
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
          } satisfies Model,
        };
      },
      EditAction: (msg) => {
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
            model: {
              ...m,
              notice: "Save or cancel this action first.",
            } satisfies Model,
          };

        return {
          model: {
            ...m,
            selected: action.noteId,
            actionId: action.id,
            action: action.text,
            owner: action.ownerId,
            due: action.dueDate,
          } satisfies Model,
          commands: [FocusAction()],
        };
      },
      Select: (msg) => {
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
            } satisfies Model,
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
          } satisfies Model,
          commands: msg.id ? [FocusAction()] : [],
        };
      },
      Confirm: (msg) => {
        return {
          model: { ...m, confirm: msg.op } satisfies Model,
          commands: [
            FocusControl({
              selector: msg.op
                ? ".confirm-bar button"
                : ".session-footer .primary",
            }),
          ],
        };
      },
      Invite: () => ({
        model: {
          ...m,
          invite: !m.invite,
          mobileMenu: false,
          toolsOpen: false,
          roomSection: "people",
          notice: "",
          inviteLoading: !m.invite,
          inviteError: "",
        } satisfies Model,
        commands:
          m.invite || m.board?.adminId !== m.actorId
            ? []
            : [LoadInvitations({ roomId: m.roomId, name: "" })],
      }),
      AddInvite: () => ({
        model: { ...m, busy: true, error: "" } satisfies Model,
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
        } satisfies Model,
      }),
      Copy: (msg) => ({ model: m, commands: [Copy({ url: msg.url })] }),
      ManageRoom: () => ({
        model: {
          ...m,
          manageRoom: !m.manageRoom,
          cleanup: false,
        } satisfies Model,
      }),
      Cleanup: () => {
        return {
          model: { ...m, cleanup: !m.cleanup, deleteTitle: "" } satisfies Model,
        };
      },
      DeleteRoom: () => {
        if (
          m.busy ||
          !m.board ||
          m.board.adminId !== m.actorId ||
          m.board.phase !== "closed" ||
          m.deleteTitle !== m.board.title
        )
          return { model: m };

        return {
          model: { ...m, busy: true, error: "" } satisfies Model,
          commands: [DeleteRetro({ roomId: m.roomId, title: m.deleteTitle })],
        };
      },
      Export: () => {
        return {
          model: m,
          commands: m.board
            ? [Export({ board: m.board, order: m.voteSort })]
            : [],
        };
      },
      Notify: (msg) => {
        return { model: { ...m, notice: msg.text } satisfies Model };
      },
      Retry: () => {
        return {
          model: {
            ...m,
            reconnect: m.reconnect + 1,
            error: "",
            connected: false,
          } satisfies Model,
        };
      },
      Run: (msg) => {
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
          } satisfies Model,
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
      Succeeded: (msg) => {
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
});
