import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import * as Redacted from "effect/Redacted";
import { afterEach, expect, it, vi } from "vitest";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Retro } from "@retro/domain/Retro.model";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { inviteToken } from "../src/inviteToken.ts";
import { SessionLive } from "../../server/src/Session.ts";
import { Enter } from "../src/application/command.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(RoomCleanup.toLayer(Effect.succeed({ remove: () => Effect.die("Unexpected retention cleanup") })))))),
  Layer.provide(Domain.InMemory),
);

afterEach(() => vi.unstubAllGlobals());

it("enters as an invited participant without facilitator invitation links", async () => {
  vi.stubGlobal("sessionStorage", { removeItem: vi.fn() });
  vi.stubGlobal("history", { replaceState: vi.fn() });

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const api = yield* RetroApi.testClient;

      const host = {
        headers: { cookie: `__Host-cg_session=${"a".repeat(64)}` },
      };

      const guest = {
        headers: { cookie: `__Host-cg_session=${"b".repeat(64)}` },
      };

      const target = RoomId.make("participant-join");
      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target,
          title: "Retro",
          name: "Host",
          password: Redacted.make("abc"),
        },
        host,
      );

      const added = yield* api.InviteParticipant(
        { target, name: "Guest" },
        host,
      );

      const invitations = (yield* api.Invitations.get(target, {
        ...host,
        atLeast: added,
      }))!;

      const participantId = invitations.people[1]!.id;

      const token = yield* Effect.promise(() =>
        inviteToken(Redacted.value(invitations.seed), participantId),
      );

      return yield* Enter({
        roomId: target,
        title: "",
        name: "",
        template: "mad-sad-glad",
        password: "abc",
        participantId,
        token,
      }).effect.pipe(
        Effect.provide(Enter.layer),
        Effect.provideService(RetroApi.Client, {
          ...api,
          JoinRoom: (input) => api.JoinRoom(input, guest),
          SharedBoard: {
            ...api.SharedBoard,
            get: (key, options) =>
              api.SharedBoard.get(key, { ...options, ...guest }),
          },
        }),
      );
    }).pipe(Effect.provide(World), Effect.scoped),
  );

  expect(result._tag).toBe("Entered");
  expect(result).not.toHaveProperty("links");
});
