import { columnsFor } from "@retro/domain/Room/Templates";
import { LoadPreview, Resume } from "./command.ts";
import { Model, Flags } from "./definition.ts";
import { ApplicationComposition } from "./composition.ts";

export const init = ApplicationComposition.makeInit((f: typeof Flags.Type) => ({
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
  } satisfies Model,
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
}));
