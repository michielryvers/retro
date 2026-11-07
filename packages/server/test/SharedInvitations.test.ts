import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { Retro } from "@retro/domain/Retro.model";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { SHARED_INVITATION } from "@retro/domain/Room/SharedInvitation";
import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import { inviteToken } from "../src/Secrets.ts";
import { SessionLive } from "../src/Session.ts";
import { testPassword } from "../../../scripts/test-access.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(RoomCleanup.toLayer(Effect.succeed({ remove: () => Effect.die("Unexpected cleanup") })))))),
  Layer.provide(Domain.InMemory),
);

const device = (value: string) => ({ headers: { cookie: `__Host-cg_session=${value.repeat(64)}` } });
const host = device("a"), guest = device("b"), other = device("c"), recovery = device("d");

it.live("one shared link grants distinct namesake identities, never private notes or facilitator powers, and preserves personal recovery", () => Effect.gen(function* () {
  const api = yield* RetroApi.clientInProcess;
  const target = RoomId.make("shared-room");
  yield* api.CreateRoom(target, { title: "Existing retro", template: "mad-sad-glad", name: "Alex", password: Redacted.make(testPassword) }, host);
  const saved = yield* api.SaveNote(target, { id: "host-note", column: "mad", text: "Host private" }, host);
  const invitations = (yield* api.Invitations.get(target, { ...host, atLeast: saved }))!;
  const sharedToken = yield* Effect.promise(() => inviteToken(Redacted.value(invitations.seed), SHARED_INVITATION));
  const credentials = { name: "Alex", token: Redacted.make(sharedToken), password: Redacted.make(testPassword) };

  expect((yield* api.JoinSharedRoom(target, credentials).pipe(Effect.flip))._tag).toBe("Unauthorized");
  expect((yield* api.JoinSharedRoom(target, { ...credentials, token: Redacted.make("0".repeat(64)) }, guest).pipe(Effect.flip))._tag).toBe("Refused");
  expect((yield* api.JoinSharedRoom(target, { ...credentials, password: Redacted.make("wrong") }, guest)).reply).toEqual({ joined: false });
  expect((yield* api.SharedBoard.get(target, guest).pipe(Effect.flip))._tag).toBe("Refused");

  // Concurrent retries from the same browser allocate only one participant.
  yield* Effect.all([api.JoinSharedRoom(target, credentials, guest), api.JoinSharedRoom(target, { ...credentials, name: "Changed" }, guest)], { concurrency: "unbounded" });
  const joined = yield* api.JoinSharedRoom(target, credentials, other);
  const board = (yield* api.SharedBoard.get(target, { ...host, atLeast: joined }))!;
  expect(board.participants).toHaveLength(3);
  const guestId = board.grants.find((g) => g.sessionId !== board.grants[0]!.sessionId)!.participantId;
  expect(guestId).not.toBe(board.adminId);
  expect(board.notes).toEqual([]);
  expect((yield* api.MyNotes.get(RoomId.make(`${target}:${board.adminId}`), guest).pipe(Effect.flip))._tag).toBe("Refused");
  expect((yield* api.RevealNotes(target, {}, guest).pipe(Effect.flip))._tag).toBe("Refused");
  expect((yield* api.Invitations.get(target, guest).pipe(Effect.flip))._tag).toBe("Refused");

  const guestSaved = yield* api.SaveNote(target, { id: "guest-note", column: "sad", text: "Guest private" }, guest);
  expect((yield* api.MyNotes.get(RoomId.make(`${target}:${guestId}`), other).pipe(Effect.flip))._tag).toBe("Refused");
  const updatedInvites = (yield* api.Invitations.get(target, { ...host, atLeast: guestSaved }))!;
  expect(updatedInvites.people).toHaveLength(3);
  const personal = yield* Effect.promise(() => inviteToken(Redacted.value(invitations.seed), guestId));
  const recovered = yield* api.JoinRoom(target, { participantId: guestId, token: Redacted.make(personal), password: Redacted.make(testPassword) }, recovery);
  expect((yield* api.MyNotes.get(RoomId.make(`${target}:${guestId}`), { ...recovery, atLeast: recovered }))?.notes[0]?.text).toBe("Guest private");
  const history = JSON.stringify(yield* api.SharedBoard.list(target, { ...host, take: 100 }));

  for (const secret of [sharedToken, Redacted.value(invitations.seed), "Host private", "Guest private", "passwordHash"]) expect(history).not.toContain(secret);

  const otherRoom = RoomId.make("another-room");
  yield* api.CreateRoom(otherRoom, { title: "Other", template: "mad-sad-glad", name: "Host", password: Redacted.make(testPassword) }, host);

  for (const id of [otherRoom, RoomId.make("missing"), RoomId.make("archive-snapshot"), RoomId.make("__admin_directory__")]) {
    expect((yield* api.JoinSharedRoom(id, credentials, recovery).pipe(Effect.exit))._tag).toBe("Failure");
  }

  const hostPersonal = yield* Effect.promise(() => inviteToken(Redacted.value(invitations.seed), board.adminId));
  expect((yield* api.JoinSharedRoom(target, { ...credentials, token: Redacted.make(hostPersonal) }, recovery).pipe(Effect.flip))._tag).toBe("Refused");
}).pipe(Effect.scoped, Effect.provide(World)), 30000);

it.live("cannot bypass shared password throttling with fresh sessions or names", () => Effect.gen(function* () {
  const api = yield* RetroApi.clientInProcess;
  const target = RoomId.make("shared-throttle");
  const created = yield* api.CreateRoom(target, { title: "Throttle", template: "mad-sad-glad", name: "Host", password: Redacted.make(testPassword) }, host);
  const invitations = (yield* api.Invitations.get(target, { ...host, atLeast: created }))!;
  const token = Redacted.make(yield* Effect.promise(() => inviteToken(Redacted.value(invitations.seed), SHARED_INVITATION)));

  for (let i = 1; i <= 5; i++) {
    expect((yield* api.JoinSharedRoom(target, { name: `Name ${i}`, token, password: Redacted.make("wrong") }, device(String(i)))).reply).toEqual({ joined: false });
  }

  const denied = yield* api.JoinSharedRoom(target, { name: "Fresh", token, password: Redacted.make(testPassword) }, other).pipe(Effect.flip);
  expect(denied._tag).toBe("Refused");
  expect(JSON.stringify(denied)).toContain("Too many attempts");
  expect((yield* api.SharedBoard.get(target, host))?.participants).toHaveLength(1);
}).pipe(Effect.scoped, Effect.provide(World)), 30000);
