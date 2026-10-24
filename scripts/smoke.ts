import * as Redacted from "effect/Redacted";
import { joinInvited, testPassword } from "./test-access.ts";
import * as Schema from "effect/Schema";
import { SessionResponse } from "../packages/domain/src/HttpContracts.ts";
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";

const origin = process.argv[2] ?? "http://localhost:5187";

async function session() {
  const r = await fetch(`${origin}/api/session`, { method: "POST" });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!;
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("SameSite=Strict"));

  if (origin.startsWith("https:")) assert.ok(cookie.includes("Secure"));
  const { id } = Schema.decodeUnknownSync(SessionResponse)(await r.json());

  return { id, headers: { cookie: cookie.split(";")[0]! } };
}

const host = await session(),
  guest = await session();

assert.notEqual(host.id, guest.id);

const room = RoomId.make(crypto.randomUUID());

await Effect.runPromise(
  Effect.gen(function* () {
    const api = yield* RetroApi.client;
    yield* api.CreateRoom(
      {
        template: "mad-sad-glad",
        password: Redacted.make(testPassword),
        target: room,
        title: "Deployment verification",
        name: "QA facilitator",
      },
      host,
    );
    guest.id = yield* joinInvited(api, room, "QA teammate", host, guest);
    host.id = (yield* api.SharedBoard.get(room, host))!.adminId;

    const saved = yield* api.SaveNote(
      {
        target: room,
        id: "test-note",
        column: "glad",
        text: "Verified private note",
      },
      guest,
    );

    console.log("Checking shared note projection");

    const before = yield* api.SharedBoard.get(room, {
      ...host,
      atLeast: saved,
    });

    assert.equal(before?.notes.length, 0);
    assert.equal(before?.tally.glad, 1);
    console.log("Checking private note projection");

    const privateView = yield* api.MyNotes.get(
      RoomId.make(`${room}:${guest.id}`),
      { ...guest, atLeast: saved },
    );

    assert.equal(privateView?.notes[0]?.text, "Verified private note");
    console.log("Checking permissions and voting");

    const denied = yield* api
      .RevealNotes({ target: room }, guest)
      .pipe(Effect.flip);

    assert.equal(denied._tag, "Refused");
    yield* api.RevealNotes({ target: room }, host);
    yield* api.StartVoting({ target: room }, host);

    const voted = yield* api.SetVote(
      { target: room, noteId: "test-note", selected: true },
      guest,
    );

    assert.equal(
      (yield* api.SharedBoard.get(room, { ...host, atLeast: voted }))?.scores
        .length,
      0,
    );
    console.log("Checking final voting projection");
    const finished = yield* api.FinishVoting({ target: room }, host);
    assert.equal(
      (yield* api.SharedBoard.get(room, { ...guest, atLeast: finished }))
        ?.scores[0]?.count,
      1,
    );
    yield* api.SaveAction(
      {
        target: room,
        id: "test-action",
        noteId: "test-note",
        text: "Try the next retrospective",
        ownerId: guest.id,
        dueDate: "",
      },
      host,
    );
    console.log("Checking closed room");
    const closed = yield* api.CloseRoom({ target: room }, host);

    const final = yield* api.SharedBoard.get(room, {
      ...guest,
      atLeast: closed,
    });

    assert.equal(final?.phase, "closed");
    assert.equal(final?.actions[0]?.text, "Try the next retrospective");
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Domain.protocolHttp(`${origin}/api`).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  ),
);

console.log(
  `Passed real HTTP session, privacy, authorization, voting, action and persistence checks: ${origin}/room/${room}`,
);
