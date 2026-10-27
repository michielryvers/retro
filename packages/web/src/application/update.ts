import { Update } from "foldkit";

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

export const update = ApplicationComposition.makeUpdate({
  CheckRoom: (m) => ({
    model: m,
    commands:
      m.entered && !isWorking(m)
        ? [Resume({ roomId: m.roomId, invitation: true })]
        : [],
  }),

  RoomUnavailable: (m) => markUnavailable(m),

  CloseRoom: (m) => ({
    model: {
      ...m,
      mobileMenu: false,
      invite: false,
      toolsOpen: false,
    } satisfies Model,
  }),
  MobileMenu: (m) =>
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
  RoomSection: (m, msg) =>
    Update.combineSteps([
      () => ({
        model: {
          ...m,
          roomSection: msg.section,
          mobileMenu: true,
          invite: msg.section === "people" && m.board?.adminId === m.actorId,
          toolsOpen: msg.section !== "people",
        } satisfies Model,
      }),
      ...(msg.section === "people"
        ? [InvitationsBinding.requestLoad(invitationContext(m))]
        : []),
    ])(m),

  Tools: (m) => ({
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

  DragStart: (m, msg) =>
    CombiningBinding.dragStart({ id: msg.id }, combiningContext(m))(m),
  DragEnd: (m) => CombiningBinding.dragEnd(combiningContext(m))(m),
  DragOver: (m, msg) =>
    CombiningBinding.dragOver({ id: msg.id }, combiningContext(m))(m),
  Drop: (m, msg) =>
    CombiningBinding.drop({ id: msg.id }, combiningContext(m))(m),

  NeedsJoin: (m) => {
    return { model: m };
  },

  Entered: (m, msg) => acceptRoom(msg)(m),
  Board: (m, msg) => receiveBoard(msg.board)(m),
  Private: (m, msg) => {
    return {
      model: {
        ...m,
        private: msg.state ?? { notes: [], votes: [], sessions: [] },
      } satisfies Model,
    };
  },

  WatchFailed: (m, msg) => {
    return {
      model: { ...m, connected: false, error: msg.reason } satisfies Model,
      commands: m.roomId
        ? [Resume({ roomId: m.roomId, invitation: true })]
        : [],
    };
  },

  Invite: (m) =>
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

  Notify: (m, msg) => NoticeBinding.informNotice({ text: msg.text })(m),
  Retry: (m) => {
    return {
      model: {
        ...m,
        reconnect: m.reconnect + 1,
        error: "",
        connected: false,
      } satisfies Model,
    };
  },
});
