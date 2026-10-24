import * as Redacted from "effect/Redacted";
import { testPassword } from "./test-access.ts";
import { WebSocket } from "ws";
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";

const origin = process.argv[2] ?? "http://localhost:5187";
const response = await fetch(`${origin}/api/session`, { method: "POST" });
const cookie = response.headers.get("set-cookie")?.split(";")[0];

assert.ok(cookie);

const room = RoomId.make(crypto.randomUUID());
const headers = { cookie };
const frames: string[] = [];
const address = new URL(`${origin.replace(/^http/, "ws")}/api`);

address.searchParams.set(
  "read",
  JSON.stringify({
    id: "idle-check",
    tag: "SharedBoard.watch",
    payload: { key: room },
  }),
);

await Effect.runPromise(
  Effect.gen(function* () {
    const api = yield* RetroApi.client;

    yield* api.CreateRoom(
      {
        template: "mad-sad-glad",
        password: Redacted.make(testPassword),
        target: room,
        title: "WebSocket idle verification",
        name: "QA",
      },
      { headers },
    );
    const socket = new WebSocket(address, { headers });

    socket.addEventListener("message", (event) =>
      frames.push(String(event.data)),
    );

    try {
      for (let attempt = 0; attempt < 100 && frames.length === 0; attempt++)
        yield* Effect.sleep("100 millis");

      assert.ok(
        frames.some((frame) => frame.includes("WebSocket idle verification")),
        "initial board arrives",
      );
      console.log("Holding the live connection idle for 25 seconds");
      yield* Effect.sleep("25 seconds");
      assert.equal(socket.readyState, WebSocket.OPEN);
      yield* api.SetReady({ target: room, ready: true }, { headers });

      for (
        let attempt = 0;
        attempt < 100 &&
        !frames.some((frame) => frame.includes('"ready":true'));
        attempt++
      )
        yield* Effect.sleep("100 millis");

      assert.ok(
        frames.some((frame) => frame.includes('"ready":true')),
        "update arrives on the original idle connection",
      );
    } finally {
      socket.close();
    }
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
  `Passed idle WebSocket delivery: ${origin}/room/${room}. This does not assert that Cloudflare evicted the object.`,
);
