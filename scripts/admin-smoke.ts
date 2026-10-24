import * as Redacted from "effect/Redacted";
import { joinInvited, testPassword } from "./test-access.ts";
import * as Schema from "effect/Schema";
import {
  SessionResponse,
  DeleteResponse,
  RoomSummaries,
} from "../packages/domain/src/HttpContracts.ts";
// Local integration test: creates and deletes only its own disposable room.
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";

const origin = "http://localhost:5187";
const room = RoomId.make(crypto.randomUUID());
const title = `Deletion QA ${room}`;

const session = async () => {
  const response = await fetch(`${origin}/api/session`, { method: "POST" });

  return {
    id: Schema.decodeUnknownSync(SessionResponse)(await response.json()).id,
    headers: { cookie: response.headers.get("set-cookie")!.split(";")[0]! },
  };
};

const host = await session(),
  guest = await session();

await Effect.runPromise(
  Effect.gen(function* () {
    const api = yield* RetroApi.client;
    yield* api.CreateRoom(
      {
        password: Redacted.make(testPassword),
        target: room,
        title,
        name: "QA host",
        template: "keep-drop-try",
      },
      host,
    );
    guest.id = yield* joinInvited(api, room, "QA guest", host, guest);
    host.id = (yield* api.SharedBoard.get(room, host))!.adminId;

    const receipt = yield* api.SaveNote(
      {
        target: room,
        id: "private",
        column: "keep",
        text: "Private deletion fixture",
      },
      guest,
    );

    yield* api.MyNotes.get(RoomId.make(`${room}:${guest.id}`), {
      ...guest,
      atLeast: receipt,
    });

    const rooms = yield* Effect.promise(async () =>
      Schema.decodeUnknownSync(RoomSummaries)(
        await (await fetch(`${origin}/admin/api/rooms`)).json(),
      ),
    );

    assert.equal(rooms.find((r) => r.id === room)?.template, "keep-drop-try");

    const bad = yield* Effect.promise(() =>
      fetch(`${origin}/admin/api/rooms`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ id: room, title: "wrong name" }),
      }),
    );

    assert.equal(bad.status, 503);

    const csrf = yield* Effect.promise(() =>
      fetch(`${origin}/admin/api/rooms`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
        },
        body: JSON.stringify({ id: room, title }),
      }),
    );

    assert.equal(csrf.status, 403);

    const deleted = yield* Effect.promise(() =>
      fetch(`${origin}/admin/api/rooms`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({ id: room, title }),
      }),
    );

    assert.equal(deleted.status, 200);
    const result = yield* Effect.promise(() => deleted.json());
    assert.equal(
      Schema.decodeUnknownSync(DeleteResponse)(result).deleted,
      true,
    );

    // Every public route must remain unusable, even to an existing participant.
    const blockedCalls: Effect.Effect<unknown, unknown>[] = [
      api.JoinRoom(
        {
          target: room,
          participantId: guest.id,
          token: Redacted.make("0".repeat(64)),
          password: Redacted.make(testPassword),
        },
        guest,
      ),
      api.CreateRoom(
        {
          template: "mad-sad-glad",
          password: Redacted.make(testPassword),
          target: room,
          title,
          name: "reuse",
        },
        host,
      ),
      api.SharedBoard.get(room, host),
      api.MyNotes.get(RoomId.make(`${room}:${guest.id}`), guest),
    ];

    for (const call of blockedCalls) {
      const result = yield* Effect.exit(call);
      assert.equal(result._tag, "Failure");
    }

    const remaining = yield* Effect.promise(async () =>
      Schema.decodeUnknownSync(RoomSummaries)(
        await (await fetch(`${origin}/admin/api/rooms`)).json(),
      ),
    );

    assert.equal(
      remaining.some((r) => r.id === room),
      false,
    );
    console.log(
      "Passed directory, template, confirmation, CSRF, deletion, private-view deletion, and deleted-ID reuse checks",
      room,
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Domain.protocolHttp(`${origin}/api`).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  ),
);
