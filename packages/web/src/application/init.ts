import { Resume } from "./command.ts";
import { Flags } from "./definition.ts";
import { ApplicationComposition } from "./composition.ts";

export const init = ApplicationComposition.makeInit((f: typeof Flags.Type) => ({
  model: {
    roomId: f.roomId,
    actorId: f.actorId,
    sessionId: f.actorId,
    unavailable: false,
    toolsOpen: false,
    mobileMenu: false,
    roomSection: "people",
    entered: false,
    board: null,
    private: { notes: [], votes: [], sessions: [] },
    error: "",
    invite: false,
    connected: false,
    reconnect: 0,
  },
  childInitContext: f,
  commands: f.roomId
    ? [Resume({ roomId: f.roomId, invitation: Boolean(f.inviteToken) })]
    : [],
}));
