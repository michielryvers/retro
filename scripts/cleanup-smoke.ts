import * as Redacted from "effect/Redacted";
import { joinInvited, testPassword } from "./test-access.ts";
import * as Schema from "effect/Schema";
import {
  SessionResponse,
  DeleteResponse,
} from "../packages/domain/src/HttpContracts.ts";
// Local integration test: creates and deletes only its own disposable room.
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";

const origin = process.argv[2] ?? "http://localhost:5187";
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

    const remove = (actor = host, name = title, requestOrigin = origin) =>
      Effect.promise(() =>
        fetch(`${origin}/api/room-cleanup`, {
          method: "DELETE",
          headers: {
            ...actor.headers,
            "Content-Type": "application/json",
            Origin: requestOrigin,
          },
          body: JSON.stringify({ id: room, title: name }),
        }),
      );

    assert.equal(
      (yield* remove()).status,
      403,
      "active rooms cannot be deleted",
    );
    yield* api.RevealNotes({ target: room }, host);
    yield* api.StartVoting({ target: room }, host);
    yield* api.FinishVoting({ target: room }, host);
    yield* api.SaveAction(
      {
        target: room,
        id: "action",
        noteId: "private",
        text: "Follow up",
        ownerId: guest.id,
        dueDate: "",
      },
      host,
    );
    yield* api.CloseRoom({ target: room }, host);
    assert.equal(
      (yield* remove(guest)).status,
      403,
      "participants cannot delete",
    );

    const denied = yield* api
      .ArchiveRoom({ target: room, archived: true }, guest)
      .pipe(Effect.flip);

    assert.equal(denied._tag, "Refused");

    const archived = yield* api.ArchiveRoom(
      { target: room, archived: true },
      host,
    );

    assert.equal(
      (yield* api.SharedBoard.get(room, { ...guest, atLeast: archived }))
        ?.archived,
      true,
    );

    const locked = yield* api
      .DeleteAction({ target: room, id: "action" }, guest)
      .pipe(Effect.flip);

    assert.equal(locked._tag, "Refused");
    yield* api.ArchiveRoom({ target: room, archived: false }, host);
    assert.equal(
      (yield* api
        .DeleteAction({ target: room, id: "action" }, guest)
        .pipe(Effect.flip))._tag,
      "Refused",
    );
    assert.equal((yield* remove(host, "wrong")).status, 403);
    assert.equal(
      (yield* remove(host, title, "https://evil.example")).status,
      403,
    );
    const deleted = yield* remove();
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

    console.log(
      "Passed facilitator-only archive/restore, read-only enforcement, active-room protection, confirmation, CSRF, full deletion and deleted-ID reuse checks",
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
