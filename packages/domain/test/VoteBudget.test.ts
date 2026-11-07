import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Redacted from "effect/Redacted";
import { Story } from "@alchemy.run/domain/Story";
import { Retro } from "../src/Retro.model.ts";
import { Room } from "../src/Room/Room.aggregate.ts";
import { RoomCreated } from "../src/Room/CreateRoom.command.ts";
import { ParticipantInvited } from "../src/Room/InviteParticipant.command.ts";
import { ParticipantJoined, SessionGranted } from "../src/Room/JoinRoom.command.ts";
import { NoteSaved } from "../src/Room/SaveNote.command.ts";
import { SetVoteLimit, VoteLimitChanged } from "../src/Room/SetVoteLimit.command.ts";
import { RevealNotes } from "../src/Room/RevealNotes.command.ts";
import { StartVoting } from "../src/Room/StartVoting.command.ts";
import { SetVote } from "../src/Room/SetVote.command.ts";
import { FinishVoting } from "../src/Room/FinishVoting.command.ts";
import { CloseRoom } from "../src/Room/CloseRoom.command.ts";
import { CombineNotes } from "../src/Room/CombineNotes.command.ts";
import { Handover } from "../src/Room/Handover.command.ts";
import { Refused } from "../src/Room/Refused.rejection.ts";
import { SharedBoard } from "../src/Room/SharedBoard.view.ts";
import { MyNotes } from "../src/Room/MyNotes.view.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { RoomRetentionLive } from "../src/Room/RoomRetention.policy.ts";
import { RoomCleanup } from "../src/Room/RoomCleanup.external.ts";

const options = { layer: RoomRetentionLive, stub: [RoomCleanup] };
const story = Story.make(Retro, { ...options, assertAllEvents: false });
const events = Story.make(Retro, options);
const room = Room.ref("vote-budget");

const setup = (count = 6) => [
  Story.given(room, new RoomCreated({
    title: "Existing retro", template: "mad-sad-glad", adminId: "host", sessionId: "host", name: "Host",
    inviteSeed: Redacted.make("unchanged-seed"), passwordSalt: "unchanged-salt", passwordHash: Redacted.make("unchanged-hash"),
  }), new ParticipantInvited({ id: "guest", name: "Guest" }), new ParticipantJoined({ id: "guest", name: "Guest" }),
  new SessionGranted({ participantId: "guest", sessionId: "guest" }),
  ...Array.from({ length: count }, (_, index) => new NoteSaved({
    note: { id: String(index), column: "mad", text: `Private note ${index}`, authorId: "host" },
  }))),
  Story.provide(CurrentActor, { id: "host" }),
];

const locked = () => Story.rejected(new Refused({ reason: "The session has moved on. Refresh your board and try again." }));

it.effect("keeps historical rooms at three votes and changes only the budget before voting", () => story(
  ...setup(),
  Story.state(room, (state) => expect(state.voteLimit).toBe(3)),
  Story.view(SharedBoard, room, (state) => expect(state?.voteLimit).toBe(3)),
  Story.when(room, new SetVoteLimit({ limit: 1 })),
  Story.view(SharedBoard, room, (state) => {
    expect(state?.voteLimit).toBe(1);
    expect(state?.notes).toEqual([]);
  }),
  Story.view(MyNotes, Room.ref("vote-budget:host"), (state) => expect(state?.notes).toHaveLength(6)),
  Story.when(room, new RevealNotes({})),
  Story.when(room, new SetVoteLimit({ limit: 5 })),
  Story.state(room, (state) => {
    expect(state.voteLimit).toBe(5);
    expect(state.notes).toHaveLength(6);
    expect(state.votes).toEqual([]);
    expect(state.grants).toEqual([{ participantId: "host", sessionId: "host" }, { participantId: "guest", sessionId: "guest" }]);
    expect(Redacted.value(state.inviteSeed)).toBe("unchanged-seed");
    expect(Redacted.value(state.passwordHash)).toBe("unchanged-hash");
    expect(state.passwordSalt).toBe("unchanged-salt");
  }),
));

it.effect("does not emit duplicate configuration events for an unchanged budget", () => events(
  ...setup(0),
  Story.when(room, new SetVoteLimit({ limit: 3 })), Story.then(room),
  Story.when(room, new SetVoteLimit({ limit: 5 })), Story.then(room, new VoteLimitChanged({ limit: 5 })),
  Story.when(room, new SetVoteLimit({ limit: 5 })), Story.then(room),
));

for (const limit of [-1, 0, 31, 1000]) {
  it.effect(`rejects out-of-range budget ${limit} without changing the room`, () => story(
    ...setup(),
    Story.when(room, new SetVoteLimit({ limit })),
    Story.rejected(new Refused({ reason: "Choose between 1 and 30 votes per person." })),
    Story.state(room, (state) => expect(state.voteLimit).toBe(3)),
  ));
}

it.effect("only lets the current facilitator configure the budget", () => story(
  ...setup(),
  Story.provide(CurrentActor, { id: "guest" }),
  Story.when(room, new SetVoteLimit({ limit: 2 })),
  Story.rejected(new Refused({ reason: "Only the facilitator can do that." })),
  Story.provide(CurrentActor, { id: "host" }),
  Story.when(room, new Handover({ participantId: "guest" })),
  Story.when(room, new SetVoteLimit({ limit: 2 })),
  Story.rejected(new Refused({ reason: "Only the facilitator can do that." })),
  Story.provide(CurrentActor, { id: "guest" }),
  Story.when(room, new SetVoteLimit({ limit: 2 })),
  Story.view(SharedBoard, room, (state) => expect(state?.voteLimit).toBe(2)),
));

it.effect("freezes the budget throughout voting, results and closure without discarding votes", () => story(
  ...setup(),
  Story.when(room, new SetVoteLimit({ limit: 4 })),
  Story.when(room, new RevealNotes({})),
  Story.when(room, new StartVoting({})),
  Story.when(room, new SetVote({ noteId: "0", selected: true })),
  Story.when(room, new SetVoteLimit({ limit: 1 })), locked(),
  Story.when(room, new FinishVoting({})),
  Story.when(room, new SetVoteLimit({ limit: 1 })), locked(),
  Story.when(room, new CloseRoom({})),
  Story.when(room, new SetVoteLimit({ limit: 1 })), locked(),
  Story.state(room, (state) => {
    expect(state.voteLimit).toBe(4);
    expect(state.votes).toEqual([{ participantId: "host", noteId: "0" }]);
  }),
));

it.effect("enforces a one-vote budget while permitting retries, removal and replacement", () => story(
  ...setup(),
  Story.when(room, new SetVoteLimit({ limit: 1 })),
  Story.when(room, new RevealNotes({})), Story.when(room, new StartVoting({})),
  Story.when(room, new SetVote({ noteId: "0", selected: true })),
  Story.when(room, new SetVote({ noteId: "0", selected: true })),
  Story.when(room, new SetVote({ noteId: "1", selected: true })),
  Story.rejected(new Refused({ reason: "You have used your vote. Remove it to vote here." })),
  Story.when(room, new SetVote({ noteId: "0", selected: false })),
  Story.when(room, new SetVote({ noteId: "1", selected: true })),
  Story.state(room, (state) => expect(state.votes).toEqual([{ participantId: "host", noteId: "1" }])),
));

it.effect("permits budgets above the previous three-vote default and refuses an extra vote", () => story(
  ...setup(),
  Story.when(room, new SetVoteLimit({ limit: 5 })),
  Story.when(room, new RevealNotes({})), Story.when(room, new StartVoting({})),
  ...[0, 1, 2, 3, 4].map((index) => Story.when(room, new SetVote({ noteId: String(index), selected: true }))),
  Story.when(room, new SetVote({ noteId: "5", selected: true })),
  Story.rejected(new Refused({ reason: "You have used all 5 votes. Remove one to vote here." })),
  Story.state(room, (state) => {
    expect(state.votes).toHaveLength(5);
    expect(state.voters).toContain("host");
  }),
));

it.effect("caps effective voting at the number of visible groups, not original notes", () => story(
  ...setup(2),
  Story.when(room, new SetVoteLimit({ limit: 30 })),
  Story.when(room, new RevealNotes({})),
  Story.when(room, new CombineNotes({ sourceId: "0", targetId: "1" })),
  Story.when(room, new StartVoting({})),
  Story.when(room, new SetVote({ noteId: "1", selected: true })),
  Story.state(room, (state) => {
    expect(state.voteLimit).toBe(30);
    expect(state.votes).toHaveLength(1);
    expect(state.voters).toContain("host");
  }),
));
