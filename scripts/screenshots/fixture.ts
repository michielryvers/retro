import { init } from "../../packages/web/src/application/init.ts";
import { type Model } from "../../packages/web/src/application/definition.ts";
import { emptyBoard } from "../../packages/domain/src/Room/Values.ts";

// Fictional, fixed content. This fixture never connects to a room or stores invitations.
export const demo: Model = {
  ...init({ actorId: "avery", roomId: "demo", participantId: "", inviteToken: "", name: "Avery" }).model,
  actorId: "avery",
  entered: true,
  connected: true,
  now: Date.UTC(2026, 0, 1),
  mobileColumn: "stop",
  board: {
    ...emptyBoard,
    title: "The Friday retro",
    template: "start-stop-continue",
    adminId: "avery",
    phase: "actions",
    participants: [
      { id: "avery", name: "Avery", ready: false },
      { id: "sam", name: "Sam", ready: false },
      { id: "noor", name: "Noor", ready: false },
    ],
    notes: [
      { id: "demo", column: "start", authorId: "avery", text: "A quick demo on Fridays. Let’s celebrate the small wins, too." },
      { id: "pair", column: "start", authorId: "sam", text: "Pair up on the tricky bits before we get stuck." },
      { id: "focus", column: "stop", authorId: "noor", text: "Meetings right in the middle of our focus time." },
      { id: "scope", column: "stop", authorId: "avery", text: "Adding “one tiny thing” after we’ve agreed the scope." },
      { id: "help", column: "continue", authorId: "sam", text: "Asking for help early. Nobody has to figure it all out alone." },
      { id: "review", column: "continue", authorId: "noor", text: "The thoughtful code reviews. I learned a lot this week." },
    ],
    tally: { start: 2, stop: 2, continue: 2 },
    scores: [
      { noteId: "demo", count: 3 }, { noteId: "pair", count: 2 },
      { noteId: "focus", count: 3 }, { noteId: "help", count: 1 },
    ],
    actions: [
      { id: "demo-action", noteId: "demo", text: "Book a 15-minute Friday demo", ownerId: "avery", dueDate: "" },
      { id: "focus-action", noteId: "focus", text: "Try meeting-free mornings next sprint", ownerId: "sam", dueDate: "" },
    ],
  },
};
