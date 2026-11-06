import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";
import { chromium } from "playwright";
import assert from "node:assert/strict";

const origin = process.argv[2] ?? "http://localhost:5187";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
});

const title = `Live grouping ${crypto.randomUUID()}`;

try {
  const host = await browser.newPage();
  await host.goto(origin);
  await host.getByLabel("Room name", { exact: true }).fill(title);
  await host.getByLabel("Your name", { exact: true }).fill("Host");
  await host.getByLabel("Room password", { exact: true }).fill("abc");
  await host.getByRole("button", { name: "Create room", exact: true }).click();
  await host.getByLabel("Participant name", { exact: true }).waitFor();
  const guests = [];

  for (const name of ["Guest A", "Guest B"]) {
    await host.getByLabel("Participant name", { exact: true }).fill(name);
    await host
      .getByRole("button", { name: "Add participant", exact: true })
      .click();
    const link = host.getByLabel(`Personal link for ${name}`, { exact: true });
    await link.waitFor();

    const guest = await browser.newPage({
      viewport:
        name === "Guest B"
          ? { width: 390, height: 844 }
          : { width: 1280, height: 800 },
    });

    // Keep existing sockets open but suppress incoming frames: models a tab
    // that lost delivery while backgrounded, without an offline/close event.
    await guest.addInitScript(() => {
      const Original = window.WebSocket;
      const stale = new Set<WebSocket>();
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          window.addEventListener("test-stall-reads", () => stale.add(this), {
            once: true,
          });
          super.addEventListener("message", (event) => {
            if (stale.has(this)) event.stopImmediatePropagation();
          });
        }
      };
    });
    await guest.goto(await link.inputValue());
    await guest.getByLabel("Room password", { exact: true }).fill("abc");
    await guest.getByRole("button", { name: "Join room", exact: true }).click();
    await guest.getByLabel("Your Mad note", { exact: true }).waitFor();
    guests.push(guest);
  }

  await host
    .getByRole("button", { name: "People & invites", exact: true })
    .click();

  const cookie = (await host.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const target = RoomId.make(new URL(host.url()).pathname.split("/").at(-1)!);
  await Effect.runPromise(
    Effect.gen(function* () {
      const api = yield* RetroApi.client;

      for (const [id, text] of [
        ["first", "First"],
        ["second", "Second"],
      ] as const)
        yield* api.SaveNote(
          { target, id, column: "mad", text },
          { headers: { cookie } },
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
  await host.locator(".note").filter({ hasText: "Second" }).waitFor();

  const next = async (label: string) => {
    await host.getByRole("button", { name: label, exact: true }).click();

    const confirmation = host.getByRole("region", {
      name: "Confirm next phase",
    });

    await confirmation.waitFor();
    await confirmation
      .getByRole("button", { name: label, exact: true })
      .click();
  };

  await next("Reveal notes");

  for (const guest of guests)
    await guest.getByText("First", { exact: true }).waitFor();
  await guests[1]!.evaluate(() =>
    window.dispatchEvent(new Event("test-stall-reads")),
  );
  await host.locator('.note[draggable="true"]').first().waitFor();
  await host
    .locator(".note")
    .filter({ hasText: "First" })
    .dragTo(host.locator(".note").filter({ hasText: "Second" }));
  await guests[0]!.locator(".combined-part").first().waitFor();
  assert.equal(await guests[1]!.locator(".combined-part").count(), 0);
  // Return from a call/background tab. No reload or participant command.
  await guests[1]!.evaluate(() => window.dispatchEvent(new Event("focus")));
  await guests[1]!
    .locator(".combined-part")
    .first()
    .waitFor({ timeout: 10000 });
  await next("Start voting");

  for (const guest of guests) {
    await guest.getByRole("button", { name: /^Vote for/ }).click();
    await guest.getByRole("button", { name: /^Remove vote from/ }).waitFor();
  }

  await next("Finish voting");
  await next("Close retrospective");
  await host.getByRole("button", { name: "Manage room", exact: true }).click();
  await host
    .getByRole("button", { name: "Delete retro…", exact: true })
    .click();
  await host
    .getByLabel(`Type “${title}” to confirm`, { exact: true })
    .fill(title);
  await host
    .getByRole("button", { name: "Permanently delete", exact: true })
    .click();
  await host.waitForURL(origin + "/");
  console.log(
    "PASS two participants, live combination, stalled background tab recovery and voting without reload",
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages())
      console.log(await page.locator("body").innerText());
  throw error;
} finally {
  await browser.close();
}
