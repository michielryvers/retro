import * as Redacted from "effect/Redacted";
import { joinInvited, testPassword } from "./test-access.ts";
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";
import { SessionResponse } from "../packages/domain/src/HttpContracts.ts";
import * as Schema from "effect/Schema";

const origin = process.argv[2] ?? "http://localhost:5187";

async function session() {
  const response = await fetch(`${origin}/api/session`, { method: "POST" });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];

  assert.ok(cookie);

  return {
    ...Schema.decodeUnknownSync(SessionResponse)(await response.json()),
    headers: { cookie },
  };
}

const host = await session();
const guest = await session();
const target = RoomId.make(crypto.randomUUID());
const title = "Facilitation verification";

await Effect.runPromise(
  Effect.gen(function* () {
    const api = yield* RetroApi.client;

    yield* api.CreateRoom(
      {
        template: "mad-sad-glad",
        password: Redacted.make(testPassword),
        target,
        title,
        name: "Host",
      },
      host,
    );
    guest.id = yield* joinInvited(api, target, "Guest", host, guest);
    host.id = (yield* api.SharedBoard.get(target, host))!.adminId;

    const denied = yield* api
      .SetTimer({ target, operation: "start", seconds: 300 }, guest)
      .pipe(Effect.flip);

    assert.equal(denied._tag, "Refused");

    const started = yield* api.SetTimer(
      { target, operation: "start", seconds: 300 },
      host,
    );

    const running = yield* api.SharedBoard.get(target, {
      ...guest,
      atLeast: started,
    });

    assert.ok((running?.timer?.endsAt ?? 0) > Date.now());
    yield* api.SetTimer({ target, operation: "pause", seconds: 0 }, host);

    const extended = yield* api.SetTimer(
      { target, operation: "extend", seconds: 60 },
      host,
    );

    const paused = yield* api.SharedBoard.get(target, {
      ...guest,
      atLeast: extended,
    });

    assert.equal(paused?.timer?.endsAt, 0);
    assert.ok((paused?.timer?.remainingMs ?? 0) > 340000);

    const handed = yield* api.Handover(
      { target, participantId: guest.id },
      host,
    );

    const handedBoard = yield* api.SharedBoard.get(target, {
      ...guest,
      atLeast: handed,
    });

    assert.equal(handedBoard?.adminId, guest.id);
    yield* api.Handover({ target, participantId: host.id }, guest);
    yield* api.SaveNote(
      { target, id: "a", column: "mad", text: "First" },
      host,
    );
    yield* api.SaveNote(
      { target, id: "b", column: "glad", text: "Second" },
      guest,
    );
    yield* api.RevealNotes({ target }, host);
    yield* api.CombineNotes({ target, sourceId: "a", targetId: "b" }, host);
    const undone = yield* api.SplitNote({ target, noteId: "b" }, host);

    const board = yield* api.SharedBoard.get(target, {
      ...guest,
      atLeast: undone,
    });

    assert.equal(board?.notes.length, 2);

    yield* api.StartVoting({ target }, host);
    yield* api.SetVote({ target, noteId: "a", selected: true }, host);
    const doneVoting = yield* api.SetVotingDone({ target, done: true }, host);
    assert.ok(
      (yield* api.SharedBoard.get(target, {
        ...host,
        atLeast: doneVoting,
      }))?.voters.includes(host.id),
    );
    yield* api.SetVote({ target, noteId: "b", selected: true }, guest);
    yield* api.FinishVoting({ target }, host);
    yield* api.CloseRoom({ target }, host);
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Domain.protocolHttp(`${origin}/api`).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  ),
);

const removed = await fetch(`${origin}/api/room-cleanup`, {
  method: "DELETE",
  headers: { ...host.headers, origin, "content-type": "application/json" },
  body: JSON.stringify({ id: target, title }),
});

assert.equal(removed.status, 200);

console.log(
  "Passed timer permissions, pause/extend, handover, Reveal-only split and voting, and cleanup.",
);
