import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import * as Redacted from "effect/Redacted";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Retro } from "@retro/domain/Retro.model";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { Room } from "@retro/domain/Room/Room.aggregate";
import { RoomId } from "@retro/domain/Room/Room.id";
import { inviteToken } from "../src/Secrets.ts";
import { SessionLive } from "../src/Session.ts";
import { invitationPreview } from "../src/InvitationPreview.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(RoomCleanup.toLayer(Effect.succeed({ remove: () => Effect.die("Unexpected retention cleanup") })))))),
  Layer.provide(Domain.InMemory),
);

it.live(
  "reveals only the invited name and room title for a valid token, without granting access",
  () =>
    Effect.gen(function* () {
      const api = yield* RetroApi.testClient;
      const room = yield* Room;
      const target = RoomId.make("preview-room");

      const host = {
        headers: { cookie: `__Host-cg_session=${"a".repeat(64)}` },
      };

      const stranger = {
        headers: { cookie: `__Host-cg_session=${"b".repeat(64)}` },
      };

      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target,
          title: "Sprint 12",
          name: "Host",
          password: Redacted.make("abc"),
        },
        host,
      );

      const receipt = yield* api.InviteParticipant(
        { target, name: "Sam" },
        host,
      );

      const invites = (yield* api.Invitations.get(target, {
        ...host,
        atLeast: receipt,
      }))!;

      const person = invites.people[1]!;

      const token = yield* Effect.promise(() =>
        inviteToken(Redacted.value(invites.seed), person.id),
      );

      const input = { roomId: target, participantId: person.id, token };
      const before = yield* room.state(target);
      expect(yield* invitationPreview(input)).toEqual({
        name: "Sam",
        title: "Sprint 12",
      });
      expect(yield* room.state(target)).toEqual(before);
      expect(
        yield* invitationPreview({ ...input, token: "0".repeat(64) }),
      ).toBeNull();
      expect(
        yield* invitationPreview({ ...input, participantId: invites.adminId }),
      ).toBeNull();
      expect(
        yield* invitationPreview({ ...input, roomId: "missing" }),
      ).toBeNull();
      expect(
        yield* invitationPreview({ ...input, roomId: "__admin_directory__" }),
      ).toBeNull();
      expect(
        (yield* api.SharedBoard.get(target, stranger).pipe(Effect.flip))._tag,
      ).toBe("Refused");
      yield* api.JoinRoom(
        {
          target,
          participantId: person.id,
          token: Redacted.make(token),
          password: Redacted.make("wrong"),
        },
        stranger,
      );
      expect(
        (yield* api.SharedBoard.get(target, stranger).pipe(Effect.flip))._tag,
      ).toBe("Refused");
    }).pipe(Effect.scoped, Effect.provide(World)),
);
