import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Redacted from "effect/Redacted";
import { Story } from "@alchemy.run/domain/Story";
import { Retro } from "../src/Retro.model.ts";
import { Room } from "../src/Room/Room.aggregate.ts";
import { RoomCreated } from "../src/Room/CreateRoom.command.ts";
import { ParticipantInvited } from "../src/Room/InviteParticipant.command.ts";
import { SessionGranted } from "../src/Room/JoinRoom.command.ts";
import { JoinSharedRoom } from "../src/Room/JoinSharedRoom.command.ts";
import { RoomClosed } from "../src/Room/CloseRoom.command.ts";
import { Refused } from "../src/Room/Refused.rejection.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { PreparedAccess } from "../src/PreparedAccess.context.ts";
import { RoomRetentionLive } from "../src/Room/RoomRetention.policy.ts";
import { RoomCleanup } from "../src/Room/RoomCleanup.external.ts";

const story = Story.make(Retro, { layer: RoomRetentionLive, stub: [RoomCleanup], assertAllEvents: false });
const room = Room.ref("shared-access");
const created = new RoomCreated({ title: "Existing room", template: "mad-sad-glad", adminId: "host", sessionId: "host", name: "Host", inviteSeed: Redacted.make("seed"), passwordSalt: "salt", passwordHash: Redacted.make("correct") });
const prepared = { id: "new-person", seed: Redacted.make("seed"), salt: "", hash: Redacted.make("correct"), validToken: true };
const join = new JoinSharedRoom({ name: " Host ", token: Redacted.make("a".repeat(64)), password: Redacted.make("abc") });
const setup = [Story.given(room, created), Story.provide(CurrentActor, { id: "device" }), Story.provide(PreparedAccess, prepared)];

it.effect("joins atomically with a distinct identity even when using the facilitator's name, and retries idempotently", () => story(
  ...setup, Story.when(room, join), Story.replied({ joined: true }),
  Story.provide(PreparedAccess, { ...prepared, id: "another-random-id" }),
  Story.when(room, new JoinSharedRoom({ ...join, name: "Different" })),
  Story.state(room, (s) => {
    expect(s.adminId).toBe("host");
    expect(s.participants).toEqual([{ id: "host", name: "Host", ready: false }, { id: "new-person", name: "Host", ready: false }]);
    expect(s.invitations).toHaveLength(2);
    expect(s.grants).toHaveLength(2);
    expect(s.grants[1]).toEqual({ participantId: "new-person", sessionId: "device" });
    expect(Redacted.value(s.inviteSeed)).toBe("seed");
    expect(Redacted.value(s.passwordHash)).toBe("correct");
  }),
));

it.effect("shares a bounded password lockout across names/devices, expires it after 15 minutes, and does not reset it on success", () => story(
  ...setup, Story.clock("2026-01-01T12:00:00Z"),
  Story.provide(PreparedAccess, { ...prepared, hash: Redacted.make("wrong") }),
  ...Array.from({ length: 4 }, () => Story.when(room, join)), Story.replied({ joined: false }),
  Story.provide(PreparedAccess, prepared), Story.when(room, join),
  Story.provide(CurrentActor, { id: "fresh-device" }),
  Story.provide(PreparedAccess, { ...prepared, id: "second-person", hash: Redacted.make("wrong") }),
  Story.when(room, join), Story.replied({ joined: false }),
  Story.provide(PreparedAccess, { ...prepared, id: "second-person" }),
  Story.clock("2026-01-01T12:14:59Z"),
  Story.when(room, new JoinSharedRoom({ ...join, name: "Another name" })),
  Story.rejected(new Refused({ reason: "Too many attempts. Try again in 15 minutes." })),
  Story.clock("2026-01-01T12:15:00Z"), Story.when(room, join), Story.replied({ joined: true }),
  Story.state(room, (s) => { expect(s.attempts).toHaveLength(1); expect(s.participants).toHaveLength(3); }),
));

for (const name of ["", "   ", "x".repeat(41)]) {
  it.effect(`rejects invalid name ${JSON.stringify(name)} without allocating an identity`, () => story(
    ...setup, Story.when(room, new JoinSharedRoom({ ...join, name })),
    Story.rejected(new Refused({ reason: "Use a name between 1 and 40 characters." })),
    Story.state(room, (s) => { expect(s.participants).toHaveLength(1); expect(s.invitations).toHaveLength(1); }),
  ));
}

for (const evidence of [{ ...prepared, validToken: false }, { ...prepared, seed: Redacted.make("other-room") }]) {
  it.effect("rejects invalid token or stale/cross-room prepared evidence", () => story(
    ...setup, Story.provide(PreparedAccess, evidence), Story.when(room, join),
    Story.rejected(new Refused({ reason: "The invitation or password is incorrect." })),
  ));
}

it.effect("refuses new identities after closure while preserving existing-browser rejoining", () => story(
  ...setup, Story.given(room, new RoomClosed({ closedAt: 1 })), Story.when(room, join),
  Story.rejected(new Refused({ reason: "This retrospective has finished. New participants cannot join." })),
  Story.provide(CurrentActor, { id: "host" }), Story.when(room, join), Story.replied({ joined: true }),
  Story.state(room, (s) => expect(s.participants).toHaveLength(1)),
));

it.effect("counts outstanding legacy invitations toward the 30-person cap", () => story(
  ...setup, Story.given(room, ...Array.from({ length: 29 }, (_, i) => new ParticipantInvited({ id: `legacy-${i}`, name: "Reserved" }))),
  Story.when(room, join), Story.rejected(new Refused({ reason: "This room has reached its 30-person limit." })),
  Story.state(room, (s) => { expect(s.invitations).toHaveLength(30); expect(s.participants).toHaveLength(1); }),
));

it.effect("enforces the existing device cap without partially allocating a person", () => story(
  ...setup, Story.given(room, ...Array.from({ length: 299 }, (_, i) => new SessionGranted({ participantId: "host", sessionId: `old-${i}` }))),
  Story.when(room, join), Story.rejected(new Refused({ reason: "This room has reached its device limit." })),
  Story.state(room, (s) => { expect(s.invitations).toHaveLength(1); expect(s.participants).toHaveLength(1); }),
));
