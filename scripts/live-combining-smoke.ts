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
  let guestNavigations = 0;

  guestPage.on("framenavigated", (frame) => {
    if (frame === guestPage.mainFrame()) guestNavigations++;
  });

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
  let privateSocket: WebSocketRoute | undefined;
  let stalledBoard: WebSocketRoute | undefined;
  let breakBoard = false;
  let refused = 0;
  let exhausted: () => void = () => {};
  const exhaustion = new Promise<void>((resolve) => { exhausted = resolve; });
  let breakPrivate = false;
  let privateRefused = 0;
  let privateExhausted: () => void = () => {};
  const privateExhaustion = new Promise<void>((resolve) => { privateExhausted = resolve; });

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

    if (request.includes("MyNotes.watch")) {
      if (breakPrivate) {
        route.close({ code: 1011, reason: "Synthetic private-stream failure" });
        privateRefused++;

        if (privateRefused === 8) {
          breakPrivate = false;
          privateExhausted();
        }

        return;
      }

      privateSocket = route;
    }

    const server = route.connectToServer();
    server.onMessage((message) => {
      if (route !== stalledBoard) route.send(message);
    });
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

    // Model a tab returning with a stale but still-open connection. A plain
    // HTTP existence check cannot restore either live stream or the board.
    assert.ok(boardSocket);
    stalledBoard = boardSocket;
    yield* api.CombineNotes(room, { sourceId: "b", targetId: "c" }, host);
    assert.equal(yield* Effect.promise(() => guestPage.locator("#note-b").count()), 1);
    yield* Effect.promise(() => guestPage.evaluate(() => window.dispatchEvent(new Event("focus"))));
    yield* Effect.promise(() => guestPage.locator("#note-c .combined-part").nth(2).waitFor({ timeout: 8000 }));
    console.log("Recovered a combined board from a stale open socket on tab return");
    yield* api.SplitNote(room, { noteId: "c" }, host);
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
    yield* api.SetVote(room, { noteId: "c", selected: false }, guest);
    yield* Effect.promise(() => guestPage.locator('#note-c button.vote[aria-pressed="false"]').waitFor());

    // A live board must not hide a dead private stream. Another tab/device's
    // vote changes must still arrive without this browser making an HTTP read.
    assert.ok(privateSocket, "participant has a live private connection");
    breakPrivate = true;
    privateSocket.close({ code: 1011, reason: "Synthetic private-stream failure" });
    console.log("Exhausting only the private stream, then sending a healthy board update");
    yield* Effect.promise(() => privateExhaustion).pipe(Effect.timeout("60 seconds"));
    yield* Effect.promise(() => guestPage.locator(".board-tools .connection").filter({ hasText: "Reconnecting" }).waitFor());
    yield* api.SetTimer(room, { operation: "start", seconds: 60 }, host);
    yield* api.SetVote(room, { noteId: "c", selected: true }, guest);
    yield* Effect.promise(() => guestPage.locator('#note-c button.vote[aria-pressed="true"]').waitFor({ timeout: 15000 }));
    assert.deepEqual(errors, []);
    assert.equal(guestNavigations, 1, "participant never refreshes or navigates away to recover");
    console.log("Passed two-browser combine/split/undo, board and private stream recovery, nested grouping and voting without refreshing");
  }).pipe(
    Effect.provide(Domain.protocolHttp(`${origin.origin}/api`)),
    Effect.provide(FetchHttpClient.layer),
    Effect.scoped,
  ));
} finally {
  await browser.close();
}
