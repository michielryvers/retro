import { RoomRetentionLive } from "../src/Room/RoomRetention.policy.ts";
import { RoomCleanup } from "../src/Room/RoomCleanup.external.ts";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Redacted from "effect/Redacted";
import { Story } from "@alchemy.run/domain/Story";
import { Retro } from "../src/Retro.model.ts";
import { Room } from "../src/Room/Room.aggregate.ts";
import { RoomCreated } from "../src/Room/CreateRoom.command.ts";
import { ParticipantInvited } from "../src/Room/InviteParticipant.command.ts";
import { JoinRoom } from "../src/Room/JoinRoom.command.ts";
import { Refused } from "../src/Room/Refused.rejection.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { PreparedAccess } from "../src/PreparedAccess.context.ts";

const story = Story.make(Retro, { layer: RoomRetentionLive, stub: [RoomCleanup] });
const room = Room.ref("access-clock");

const prepared = {
  id: "",
  seed: Redacted.make("seed"),
  salt: "salt",
  hash: Redacted.make("wrong"),
  validToken: true,
};

const join = new JoinRoom({
  participantId: "guest",
  token: Redacted.make("a".repeat(64)),
  password: Redacted.make("abc"),
});

it.effect(
  "records failed joins, explicitly replies, and expires lockout on the command clock",
  () =>
    story(
      Story.given(
        room,
        new RoomCreated({
          title: "Retro",
          template: "mad-sad-glad",
          adminId: "host",
          name: "Host",
          sessionId: "host",
          inviteSeed: Redacted.make("seed"),
          passwordSalt: "salt",
          passwordHash: Redacted.make("correct"),
        }),
        new ParticipantInvited({ id: "guest", name: "Guest" }),
      ),
      Story.provide(CurrentActor, { id: "device" }),
      Story.provide(PreparedAccess, prepared),
      Story.clock("2026-01-01T12:00:00Z"),
      ...Array.from({ length: 5 }, () => Story.when(room, join)),
      Story.replied({ joined: false }),
      Story.provide(PreparedAccess, {
        ...prepared,
        hash: Redacted.make("correct"),
      }),
      Story.clock("2026-01-01T12:14:59Z"),
      Story.when(room, join),
      Story.rejected(
        new Refused({ reason: "Too many attempts. Try again in 15 minutes." }),
      ),
      Story.clock("2026-01-01T12:15:00Z"),
      Story.when(room, join),
      Story.replied({ joined: true }),
      Story.state(room, (s) => {
        expect(s.attempts).toEqual([]);
        expect(s.grants).toContainEqual({
          participantId: "guest",
          sessionId: "device",
        });
      }),
      Story.when(room, join),
      Story.replied({ joined: true }),
    ),
);
