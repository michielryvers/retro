import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { Retro } from "@retro/domain/Retro.model";
import { RoomId } from "@retro/domain/Room/Room.id";
import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import { SessionLive } from "../src/Session.ts";
import { joinInvited, testPassword } from "../../../scripts/test-access.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(
    RoomCleanup.toLayer(Effect.succeed({ remove: () => Effect.die("Unexpected retention cleanup") })),
  )))),
  Layer.provide(Domain.InMemory),
);

const host = { headers: { cookie: `__Host-cg_session=${"a".repeat(64)}` } };
const guest = { headers: { cookie: `__Host-cg_session=${"b".repeat(64)}` } };

it.live("authenticates and authorizes the new public configuration command", () => Effect.gen(function* () {
  const api = yield* RetroApi.clientInProcess;
  const target = RoomId.make("vote-budget-api");

  yield* api.CreateRoom(target, { title: "Voting", template: "mad-sad-glad", name: "Host", password: Redacted.make(testPassword) }, host);
  yield* joinInvited(api, target, "Guest", host, guest);
  expect((yield* api.SetVoteLimit(target, { limit: 5 }).pipe(Effect.flip))._tag).toBe("Unauthorized");
  expect((yield* api.SetVoteLimit(target, { limit: 5 }, guest).pipe(Effect.flip))._tag).toBe("Refused");
  expect((yield* api.SharedBoard.get(target, host))?.voteLimit).toBe(3);
  const changed = yield* api.SetVoteLimit(target, { limit: 5 }, host);

  expect((yield* api.SharedBoard.get(target, { ...guest, atLeast: changed }))?.voteLimit).toBe(5);
}).pipe(Effect.scoped, Effect.provide(World)));

it.live("rejects fractional, non-finite and out-of-range configuration at the RPC boundary", () => Effect.gen(function* () {
  const api = yield* RetroApi.clientInProcess;
  const target = RoomId.make("invalid-vote-budget-api");

  yield* api.CreateRoom(target, { title: "Voting", template: "mad-sad-glad", name: "Host", password: Redacted.make(testPassword) }, host);

  for (const limit of [1.5, NaN, Infinity, -1, 0, 31]) {
    expect((yield* api.SetVoteLimit(target, { limit }, host).pipe(Effect.exit))._tag).toBe("Failure");
  }

  expect((yield* api.SharedBoard.get(target, host))?.voteLimit).toBe(3);
}).pipe(Effect.scoped, Effect.provide(World)));
