// Real desktop/mobile controls and independent participant state; synthetic,
// local-only rooms. Production credentials and room contents are never used.
import assert from "node:assert/strict";
import { chromium, type BrowserContext, type Page } from "playwright";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Redacted from "effect/Redacted";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { joinInvited, testPassword } from "./test-access.ts";

const origin = new URL(process.argv[2] ?? "http://localhost:5187");

if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Voting browser checks only run locally");

const browser = await chromium.launch();

try {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const errors: string[] = [];

  for (const page of [hostPage, guestPage]) page.on("pageerror", (error) => errors.push(error.message));

  const session = async (context: BrowserContext) => {
    await context.request.post(`${origin.origin}/api/session`);
    const cookie = (await context.cookies()).find((cookie) => cookie.name === "__Host-cg_session");

    assert.ok(cookie);

    return { headers: { cookie: `${cookie.name}=${cookie.value}` } };
  };

  const host = await session(hostContext);
  const guest = await session(guestContext);
  const waitBudget = (page: Page, limit: number) => page.getByText(`Vote budget: ${limit} ${limit === 1 ? "vote" : "votes"} per person.`, { exact: true }).waitFor();

  const mobileSettings = async () => {
    await hostPage.getByRole("button", { name: "Room menu", exact: true }).click();
    await hostPage.getByRole("navigation", { name: "Room sections" }).getByRole("button", { name: "Voting", exact: true }).click();
  };

  await Effect.runPromise(Effect.gen(function* () {
    const api = yield* RetroApi.client;

    const create = Effect.fn(function* (count: number) {
      const room = RoomId.make(crypto.randomUUID());

      yield* api.CreateRoom(room, { title: "Vote budget regression", template: "mad-sad-glad", name: "Host", password: Redacted.make(testPassword) }, host);
      yield* joinInvited(api, room, "Guest", host, guest);

      for (let index = 0; index < count; index++) yield* api.SaveNote(room, { id: String(index), column: "mad", text: `Note ${index}` }, guest);

      return room;
    });

    const room = yield* create(3);

    yield* Effect.promise(() => Promise.all([hostPage.goto(`${origin.origin}/room/${room}`), guestPage.goto(`${origin.origin}/room/${room}`)]));
    yield* Effect.promise(() => waitBudget(guestPage, 3));
    yield* Effect.promise(() => hostPage.getByRole("button", { name: "Facilitator controls", exact: true }).click());
    yield* Effect.promise(() => hostPage.getByLabel("Votes per person", { exact: true }).selectOption("1"));
    yield* Effect.promise(() => waitBudget(guestPage, 1));
    assert.equal(yield* Effect.promise(() => guestPage.getByLabel("Votes per person", { exact: true }).count()), 0);

    // A deliberate reload checks persistence, not propagation: the other
    // participant already received the change on its existing live connection.
    yield* Effect.promise(() => hostPage.reload());
    yield* Effect.promise(() => waitBudget(hostPage, 1));
    yield* Effect.promise(() => hostPage.setViewportSize({ width: 390, height: 844 }));
    yield* Effect.promise(mobileSettings);
    yield* Effect.promise(() => hostPage.getByLabel("Votes per person", { exact: true }).selectOption("2"));
    yield* Effect.promise(() => waitBudget(guestPage, 2));
    yield* Effect.promise(() => hostPage.getByLabel("Votes per person", { exact: true }).selectOption("1"));
    yield* Effect.promise(() => waitBudget(guestPage, 1));
    assert.ok(yield* Effect.promise(() => hostPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));
    yield* Effect.promise(() => hostPage.locator("#room-sheet .room-sheet-close").click());
    yield* api.RevealNotes(room, {}, host);
    yield* api.StartVoting(room, {}, host);
    yield* Effect.promise(() => guestPage.locator("#note-0 button.vote").click());
    yield* Effect.promise(() => guestPage.locator('#note-0 button.vote[aria-pressed="true"]').waitFor());
    assert.equal(yield* Effect.promise(() => guestPage.locator("#note-1 button.vote").isDisabled()), true);
    expectRefused(yield* api.SetVote(room, { noteId: "1", selected: true }, guest).pipe(Effect.flip), "You have used your vote.");
    yield* Effect.promise(mobileSettings);
    assert.equal(yield* Effect.promise(() => hostPage.getByLabel("Votes per person", { exact: true }).isDisabled()), true);
    expectRefused(yield* api.SetVoteLimit(room, { limit: 5 }, host).pipe(Effect.flip), "The session has moved on.");
    yield* Effect.promise(() => hostPage.locator("#room-sheet .room-sheet-close").click());

    const larger = yield* create(6);

    yield* api.RevealNotes(larger, {}, host);
    yield* Effect.promise(() => hostPage.setViewportSize({ width: 1280, height: 800 }));
    yield* Effect.promise(() => Promise.all([hostPage.goto(`${origin.origin}/room/${larger}`), guestPage.goto(`${origin.origin}/room/${larger}`)]));
    yield* Effect.promise(() => hostPage.getByRole("button", { name: "Facilitator controls", exact: true }).click());
    yield* Effect.promise(() => hostPage.getByLabel("Votes per person", { exact: true }).selectOption("5"));
    yield* Effect.promise(() => waitBudget(guestPage, 5));
    yield* api.StartVoting(larger, {}, host);

    for (let index = 0; index < 5; index++) {
      yield* Effect.promise(() => guestPage.locator(`#note-${index} button.vote`).click());
      yield* Effect.promise(() => guestPage.locator(`#note-${index} button.vote[aria-pressed="true"]`).waitFor());
    }

    assert.equal(yield* Effect.promise(() => guestPage.locator("#note-5 button.vote").isDisabled()), true);
    expectRefused(yield* api.SetVote(larger, { noteId: "5", selected: true }, guest).pipe(Effect.flip), "You have used all 5 votes.");
    assert.deepEqual(errors, []);
    console.log("Passed default, desktop/mobile configuration, live propagation, persistence, one/five-vote enforcement and locking after voting starts");
  }).pipe(
    Effect.provide(Domain.protocolHttp(`${origin.origin}/api`)),
    Effect.provide(FetchHttpClient.layer),
    Effect.scoped,
  ));
} finally {
  await browser.close();
}

function expectRefused(error: { readonly _tag: string }, reason: string) {
  assert.equal(error._tag, "Refused");
  assert.ok(JSON.stringify(error).includes(reason));
}
