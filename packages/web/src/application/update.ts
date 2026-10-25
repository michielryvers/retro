import { Update } from "foldkit";

import * as Match from "effect/Match";

import { Resume, FocusControl } from "./command.ts";
import { Model } from "./definition.ts";
import {
  ApplicationComposition,
  InvitationsBinding,
  invitationContext,
  acceptRoom,
  CombiningBinding,
  combiningContext,
  NoticeBinding,
  isWorking,
  receiveBoard,
  markUnavailable,
} from "./composition.ts";

export const update = ApplicationComposition.makeUpdate((m, msg) => {
  return Match.value(msg).pipe(
    Match.tagsExhaustive({
      CheckRoom: () => ({
        model: m,
        commands:
          m.entered && !isWorking(m)
            ? [Resume({ roomId: m.roomId, invitation: true })]
            : [],
      }),

      RoomUnavailable: () => markUnavailable(m),

      CloseRoom: () => ({
        model: {
          ...m,
          mobileMenu: false,
          invite: false,
          toolsOpen: false,
        } satisfies Model,
      }),
      MobileMenu: () =>
        Update.combineSteps([
          () => ({
            model: {
              ...m,
              mobileMenu: true,
              roomSection: "people",
              invite: m.board?.adminId === m.actorId,
              toolsOpen: false,
            } satisfies Model,
          }),
          InvitationsBinding.requestLoad(invitationContext(m)),
        ])(m),
      RoomSection: (msg) =>
        Update.combineSteps([
          () => ({
            model: {
              ...m,
              roomSection: msg.section,
              mobileMenu: true,
              invite:
                msg.section === "people" && m.board?.adminId === m.actorId,
              toolsOpen: msg.section !== "people",
            } satisfies Model,
          }),
          ...(msg.section === "people"
            ? [InvitationsBinding.requestLoad(invitationContext(m))]
            : []),
        ])(m),

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

      DragStart: (msg) =>
        CombiningBinding.dragStart({ id: msg.id }, combiningContext(m))(m),
      DragEnd: () => CombiningBinding.dragEnd(combiningContext(m))(m),
      DragOver: (msg) =>
        CombiningBinding.dragOver({ id: msg.id }, combiningContext(m))(m),
      Drop: (msg) =>
        CombiningBinding.drop({ id: msg.id }, combiningContext(m))(m),

      NeedsJoin: () => {
        return { model: m };
      },

      Entered: (msg) => acceptRoom(msg)(m),
      Board: (msg) => receiveBoard(msg.board)(m),
      Private: (msg) => {
        return {
          model: {
            ...m,
            private: msg.state ?? { notes: [], votes: [], sessions: [] },
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

      Invite: () =>
        Update.combineSteps([
          () =>
            Update.combineSteps([
              () => ({
                model: {
                  ...m,
                  invite: !m.invite,
                  mobileMenu: false,
                  toolsOpen: false,
                  roomSection: "people",
                } satisfies Model,
              }),
              NoticeBinding.informNotice({ text: "" }),
            ])(m),
          ...(!m.invite
            ? [InvitationsBinding.requestLoad(invitationContext(m))]
            : []),
        ])(m),

      Notify: (msg) => NoticeBinding.informNotice({ text: msg.text })(m),
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
    }),
  );
});
