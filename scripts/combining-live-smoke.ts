import * as Redacted from "effect/Redacted";
import { joinInvited, testPassword } from "./test-access.ts";
import { WebSocket } from "ws";
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";

const origin = process.argv[2] ?? "http://localhost:5187";

async function session() {
  const response = await fetch(`${origin}/api/session`, { method: "POST" });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  return { headers: { cookie } };
}

const host = await session();
const guests = await Promise.all([session(), session()]);
const target = RoomId.make(crypto.randomUUID());
const title = "Live combining verification";
const sockets: WebSocket[] = [];
const frames: string[][] = [];

const waitFor = (predicate: () => boolean, label: string) =>
  Effect.gen(function* () {
    for (let i = 0; i < 100 && !predicate(); i++)
      yield* Effect.sleep("100 millis");
    assert.ok(predicate(), label);
  });

await Effect.runPromise(
  Effect.gen(function* () {
    const api = yield* RetroApi.client;
    yield* api.CreateRoom(
      {
        target,
        title,
        name: "Host",
        template: "mad-sad-glad",
        password: Redacted.make(testPassword),
      },
      host,
    );

    for (const [i, guest] of guests.entries()) {
      yield* joinInvited(api, target, `Guest ${i}`, host, guest);
      const address = new URL(`${origin.replace(/^http/, "ws")}/api`);
      address.searchParams.set(
        "read",
        JSON.stringify({
          id: `guest-${i}`,
          tag: "SharedBoard.watch",
          payload: { key: target },
        }),
      );
      const received: string[] = [];
      frames.push(received);
      const socket = new WebSocket(address, guest);
      sockets.push(socket);
      socket.on("message", (data) => received.push(String(data)));
    }

    yield* waitFor(
      () => frames.every((f) => f.some((x) => x.includes(title))),
      "both participants receive initial board",
    );
    yield* api.SaveNote(
      { target, id: "a", column: "mad", text: "First note" },
      host,
    );
    yield* api.SaveNote(
      { target, id: "b", column: "glad", text: "Second note" },
      guests[0]!,
    );
    yield* api.RevealNotes({ target }, host);
    yield* waitFor(
      () => frames.every((f) => f.some((x) => x.includes('"phase":"reveal"'))),
      "both see reveal",
    );
    yield* api.CombineNotes({ target, sourceId: "a", targetId: "b" }, host);
    yield* waitFor(
      () => frames.every((f) => f.at(-1)?.includes('"parts":')),
      "both receive combined notes without refresh",
    );
    yield* api.SplitNote({ target, noteId: "b" }, host);
    yield* waitFor(
      () =>
        frames.every(
          (f) => Boolean(f.at(-1)) && !f.at(-1)!.includes('"parts":'),
        ),
      "both receive split on the same connections",
    );
    yield* api.CombineNotes({ target, sourceId: "a", targetId: "b" }, host);
    yield* api.StartVoting({ target }, host);
    yield* waitFor(
      () => frames.every((f) => f.some((x) => x.includes('"phase":"vote"'))),
      "both see voting",
    );

    for (const guest of guests)
      yield* api.SetVote({ target, noteId: "b", selected: true }, guest);
    yield* api.FinishVoting({ target }, host);
    yield* api.CloseRoom({ target }, host);
    console.log(
      "PASS both participants receive grouping and can vote without refreshing",
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Domain.protocolHttp(`${origin}/api`).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  ),
).finally(() => sockets.forEach((s) => s.close()));

const removed = await fetch(`${origin}/api/room-cleanup`, {
  method: "DELETE",
  headers: { ...host.headers, origin, "content-type": "application/json" },
  body: JSON.stringify({ id: target, title }),
});

assert.equal(removed.status, 200);
