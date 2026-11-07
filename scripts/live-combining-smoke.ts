// Two real browser sessions, fictional local data only. No page reloads or
// board polling: the participant must receive the facilitator's live changes.
import assert from "node:assert/strict";
import { chromium, type WebSocketRoute } from "playwright";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Redacted from "effect/Redacted";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { joinInvited, testPassword } from "./test-access.ts";

const origin = new URL(process.argv[2] ?? "http://localhost:5187");

if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Live browser checks only run against a local instance");

const browser = await chromium.launch();

try {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const errors: string[] = [];
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  for (const page of [hostPage, guestPage]) page.on("pageerror", (error) => errors.push(error.message));

  const headersFor = async (context: typeof hostContext) => {
    await context.request.post(`${origin.origin}/api/session`);
    const cookies = await context.cookies();
    const cookie = cookies.find((cookie) => cookie.name === "__Host-cg_session");

    assert.ok(cookie, "browser receives its own session cookie");

    return { headers: { cookie: `${cookie.name}=${cookie.value}` } };
  };
  const host = await headersFor(hostContext);
  const guest = await headersFor(guestContext);
  let boardSocket: WebSocketRoute | undefined;
  let breakBoard = false;
  let refused = 0;
  let exhausted: () => void = () => {};
  const exhaustion = new Promise<void>((resolve) => { exhausted = resolve; });

  await guestPage.routeWebSocket("**/api?read=*", (route) => {
    const request = new URL(route.url()).searchParams.get("read") ?? "";

    if (request.includes("SharedBoard.watch")) {
      if (breakBoard) {
        route.close({ code: 1011, reason: "Synthetic live-stream failure" });
        refused++;

        // The existing socket plus these eight retries exhaust the transport.
        // HTTP stays healthy. A new application-level subscription can connect.
        if (refused === 8) {
          breakBoard = false;
          exhausted();
        }

        return;
      }

      boardSocket = route;
    }

    route.connectToServer();
  });

  await Effect.runPromise(Effect.gen(function* () {
    const api = yield* RetroApi.client;
    const room = RoomId.make(crypto.randomUUID());

    yield* api.CreateRoom(room, { title: "Live combine regression", template: "mad-sad-glad", name: "Facilitator", password: Redacted.make(testPassword) }, host);
    const guestId = yield* joinInvited(api, room, "Participant", host, guest);

    yield* api.SaveNote(room, { id: "a", column: "mad", text: "Too many meetings" }, host);
    yield* api.SaveNote(room, { id: "b", column: "sad", text: "Not enough focus time" }, guest);
    yield* api.SaveNote(room, { id: "c", column: "glad", text: "Keep pairing" }, guest);
    yield* api.RevealNotes(room, {}, host);
    yield* Effect.promise(() => Promise.all([hostPage.goto(`${origin.origin}/room/${room}`), guestPage.goto(`${origin.origin}/room/${room}`)]));

    for (const page of [hostPage, guestPage]) yield* Effect.promise(() => page.locator("#note-a").waitFor());

    // Exercise the real facilitator interaction and its acknowledgement as
    // well as the other participant's independent live subscription.
    yield* Effect.promise(() => hostPage.locator("#note-a").dragTo(hostPage.locator("#note-b")));

    for (const page of [hostPage, guestPage]) {
      yield* Effect.promise(() => page.locator("#note-b .combined-part").nth(1).waitFor());
      assert.equal(yield* Effect.promise(() => page.locator("#note-a").count()), 0);
    }

    yield* api.SplitNote(room, { noteId: "b" }, host);
    yield* Effect.promise(() => guestPage.locator("#note-a").waitFor());
    yield* api.CombineNotes(room, { sourceId: "a", targetId: "b" }, host);
    yield* Effect.promise(() => guestPage.locator("#note-b .combined-part").nth(1).waitFor());
    yield* api.UndoCombine(room, {}, host);
    yield* Effect.promise(() => guestPage.locator("#note-a").waitFor());
    yield* api.CombineNotes(room, { sourceId: "a", targetId: "b" }, host);
    yield* Effect.promise(() => guestPage.locator("#note-b .combined-part").nth(1).waitFor());

    assert.ok(boardSocket, "participant has a real live-board connection");
    breakBoard = true;
    boardSocket.close({ code: 1011, reason: "Synthetic live-stream failure" });
    console.log("Exhausting board WebSocket retries while HTTP remains available");
    yield* Effect.promise(() => exhaustion).pipe(Effect.timeout("60 seconds"));
    yield* api.CombineNotes(room, { sourceId: "b", targetId: "c" }, host);
    yield* Effect.promise(() => guestPage.locator("#note-c .combined-part").nth(2).waitFor({ timeout: 15000 }));

    yield* api.StartVoting(room, {}, host);
    yield* Effect.promise(() => guestPage.locator("#note-c button.vote").click());
    yield* Effect.promise(() => guestPage.locator('#note-c button.vote[aria-pressed="true"]').waitFor());
    const mine = yield* api.MyNotes.get(RoomId.make(`${room}:${guestId}`), guest);

    assert.deepEqual(mine?.votes, ["c"]);
    assert.deepEqual(errors, []);
    console.log("Passed two-browser combine/split/undo, exhausted-stream recovery, nested grouping and voting without refreshing");
  }).pipe(
    Effect.provide(Domain.protocolHttp(`${origin.origin}/api`)),
    Effect.provide(FetchHttpClient.layer),
    Effect.scoped,
  ));
} finally {
  await browser.close();
}
