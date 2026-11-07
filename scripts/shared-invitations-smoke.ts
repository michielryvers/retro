// Synthetic local rooms only: real shared-link entry, identity isolation,
// browser rejoining and compatibility with personal invitation recovery.
import assert from "node:assert/strict";
import { chromium, type BrowserContext, type Page } from "playwright";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Redacted from "effect/Redacted";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { SHARED_INVITATION } from "@retro/domain/Room/SharedInvitation";
import { inviteToken } from "../packages/server/src/Secrets.ts";
import { testPassword } from "./test-access.ts";

const origin = new URL(process.argv[2] ?? "http://localhost:5187");

if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("Invitation browser checks only run locally");

const browser = await chromium.launch();

try {
  const hostContext = await browser.newContext();
  await hostContext.request.post(`${origin.origin}/api/session`);

  const credentials = async (context: BrowserContext) => {
    const cookie = (await context.cookies()).find((cookie) => cookie.name === "__Host-cg_session");
    assert.ok(cookie);

    return { headers: { cookie: `${cookie.name}=${cookie.value}` } };
  };

  const host = await credentials(hostContext);
  const hostPage = await hostContext.newPage();
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const otherContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const otherPage = await otherContext.newPage();
  const errors: string[] = [];

  for (const page of [hostPage, guestPage, otherPage]) page.on("pageerror", (error) => errors.push(error.message));

  const join = async (page: Page, url: string, name?: string) => {
    await page.goto(url);

    if (name !== undefined) await page.getByLabel("Your name", { exact: true }).fill(name);
    await page.getByLabel("Room password", { exact: true }).fill(testPassword);
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await page.locator(".board-header").waitFor({ state: "attached" });
  };

  await Effect.runPromise(Effect.gen(function* () {
    const api = yield* RetroApi.client;
    // Room creation immediately presents one link; no advance name collection.
    yield* Effect.promise(() => hostPage.goto(origin.origin));
    yield* Effect.promise(() => hostPage.getByLabel("Room name", { exact: true }).fill("New shared-link room"));
    yield* Effect.promise(() => hostPage.getByLabel("Your name", { exact: true }).fill("Alex"));
    yield* Effect.promise(() => hostPage.getByLabel("Room password", { exact: true }).fill(testPassword));
    yield* Effect.promise(() => hostPage.getByRole("button", { name: "Create room", exact: true }).click());
    yield* Effect.promise(() => hostPage.getByLabel("Room invitation link", { exact: true }).waitFor());
    assert.match(yield* Effect.promise(() => hostPage.getByLabel("Room invitation link", { exact: true }).inputValue()), /#invite=room\.[a-f0-9]{64}$/);

    const target = RoomId.make(crypto.randomUUID());
    const created = yield* api.CreateRoom(target, { title: "Shared invitation regression", template: "mad-sad-glad", name: "Alex", password: Redacted.make(testPassword) }, host);
    const invitations = (yield* api.Invitations.get(target, { ...host, atLeast: created }))!;
    const sharedToken = yield* Effect.promise(() => inviteToken(Redacted.value(invitations.seed), SHARED_INVITATION));
    const url = `${origin.origin}/room/${target}#invite=${SHARED_INVITATION}.${sharedToken}`;

    yield* Effect.promise(() => hostPage.goto(`${origin.origin}/room/${target}`));
    yield* Effect.promise(() => hostPage.getByRole("button", { name: "People & invites", exact: true }).click());
    yield* Effect.promise(() => hostPage.getByLabel("Room invitation link", { exact: true }).waitFor());
    assert.equal(yield* Effect.promise(() => hostPage.getByLabel("Room invitation link", { exact: true }).inputValue()), url);
    assert.equal(yield* Effect.promise(() => hostPage.getByRole("button", { name: "Add participant", exact: true }).count()), 0);

    // Both browsers use exactly the same link and display name, even the host's.
    yield* Effect.promise(() => join(guestPage, url, "Alex"));
    yield* Effect.promise(() => join(otherPage, url, "Alex"));
    const guest = yield* Effect.promise(() => credentials(guestContext));
    const other = yield* Effect.promise(() => credentials(otherContext));
    const saved = yield* api.SaveNote(target, { id: "private", column: "mad", text: "Only the first Alex can read this" }, guest);
    const board = (yield* api.SharedBoard.get(target, { ...host, atLeast: saved }))!;
    assert.equal(board.participants.length, 3);
    assert.equal(new Set(board.participants.map((p) => p.id)).size, 3);
    assert.equal(new Set(board.participants.map((p) => p.name)).size, 1);
    const guestId = board.grants[1]!.participantId;
    const mine = RoomId.make(`${target}:${guestId}`);
    assert.equal((yield* api.MyNotes.get(mine, other).pipe(Effect.flip))._tag, "Refused");
    assert.equal((yield* api.RevealNotes(target, {}, guest).pipe(Effect.flip))._tag, "Refused");
    assert.equal(yield* Effect.promise(() => guestPage.getByRole("button", { name: "Facilitator controls", exact: true }).count()), 0);
    assert.ok(yield* Effect.promise(() => guestPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)));

    // A reload and then reopening the invitation reuse the same cookie grant.
    yield* Effect.promise(() => guestPage.reload());
    yield* Effect.promise(() => guestPage.getByText("Only the first Alex can read this", { exact: true }).waitFor());
    yield* Effect.promise(() => guestPage.goto(url));
    yield* Effect.promise(() => guestPage.getByText("Only the first Alex can read this", { exact: true }).waitFor());
    assert.equal((yield* api.SharedBoard.get(target, host))?.participants.length, 3);
    assert.equal(yield* Effect.promise(() => guestPage.evaluate(() => location.hash)), "");

    // The facilitator can retrieve a personal recovery link for a shared joiner.
    yield* Effect.promise(() => hostPage.getByRole("button", { name: "Close", exact: true }).click());
    yield* Effect.promise(() => hostPage.getByRole("button", { name: "People & invites", exact: true }).click());
    yield* Effect.promise(() => hostPage.getByText("Personal recovery links", { exact: true }).click());
    const personalToken = yield* Effect.promise(() => inviteToken(Redacted.value(invitations.seed), guestId));
    const personalUrl = `${origin.origin}/room/${target}#invite=${guestId}.${personalToken}`;
    yield* Effect.promise(() => hostPage.locator(`#invite-${guestId}`).waitFor());
    assert.equal(yield* Effect.promise(() => hostPage.locator(`#invite-${guestId}`).inputValue()), personalUrl);
    const recoveryContext = yield* Effect.promise(() => browser.newContext());
    const recoveryPage = yield* Effect.promise(() => recoveryContext.newPage());
    yield* Effect.promise(() => join(recoveryPage, personalUrl));
    yield* Effect.promise(() => recoveryPage.getByText("Only the first Alex can read this", { exact: true }).waitFor());
    const recovery = yield* Effect.promise(() => credentials(recoveryContext));
    assert.equal((yield* api.MyNotes.get(mine, recovery))?.notes[0]?.text, "Only the first Alex can read this");

    // Finished retros remain readable to existing people, not new shared joins.
    yield* api.RevealNotes(target, {}, host);
    yield* api.StartVoting(target, {}, host);
    yield* api.FinishVoting(target, {}, host);
    yield* api.CloseRoom(target, {}, host);
    const freshContext = yield* Effect.promise(() => browser.newContext());
    const freshPage = yield* Effect.promise(() => freshContext.newPage());
    yield* Effect.promise(() => freshPage.goto(url));
    yield* Effect.promise(() => freshPage.getByLabel("Your name", { exact: true }).fill("New person"));
    yield* Effect.promise(() => freshPage.getByLabel("Room password", { exact: true }).fill(testPassword));
    yield* Effect.promise(() => freshPage.getByRole("button", { name: "Join room", exact: true }).click());
    yield* Effect.promise(() => freshPage.getByText("This retrospective has finished. New participants cannot join.", { exact: true }).waitFor());
    assert.deepEqual(errors, []);
    console.log("Passed one shared link, desktop/mobile self-naming, duplicate-name isolation, same-browser rejoin, personal recovery and finished-room protection");
  }).pipe(Effect.provide(Domain.protocolHttp(`${origin.origin}/api`)), Effect.provide(FetchHttpClient.layer), Effect.scoped));
} finally {
  await browser.close();
}
