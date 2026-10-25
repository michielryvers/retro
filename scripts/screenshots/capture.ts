import {
  NavigationBinding,
  navigationContext,
} from "../../packages/web/src/application/composition.ts";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import * as Effect from "effect/Effect";
import { renderToString } from "foldkit/experimental/server";
import { Block } from "foldkit";
import { chromium } from "playwright";
import { createServer } from "vite";
import { ApplicationComposition } from "../../packages/web/src/application/composition.ts";
import { EffectsLayer } from "../../packages/web/src/application/effects.ts";
import { Model } from "../../packages/web/src/application/definition.ts";
import { view } from "../../packages/web/src/application/view.ts";
import { update } from "../../packages/web/src/application/update.ts";
import { demo } from "./fixture.ts";

const root = resolve(import.meta.dirname, "../..");

// Render the same checked composition with deterministic initial state. Server
// rendering does not run Commands or construct the live RPC service.
const {
  navigation: _navigation,
  notice: _notice,
  sessionControls: _sessionControls,
  combining: _combining,
  lifecycle: _lifecycle,
  notes: _notes,
  actionEditor: _actionEditor,
  entry: _entry,
  invitations: _invitations,
  timer: _timer,
  handover: _handover,
  ...demoFields
} = demo;

const prepare = () =>
  ApplicationComposition.prepareBlock({
    init: ApplicationComposition.makeInit(() => ({
      model: demoFields,
      steps: [
        NavigationBinding.informRoom(navigationContext(demo)),
        NavigationBinding.focusColumn(
          { column: "stop" },
          navigationContext(demo),
        ),
      ],
      childInitContext: {
        actorId: "avery",
        roomId: "demo",
        participantId: "",
        inviteToken: "",
        name: "Avery",
      },
    })),
    view,
    update,
    EffectsLayer,
  });

const ScreenshotBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);

const rendered = await Effect.runPromise(
  renderToString(ScreenshotBlock, {}, { isHydratable: false }),
);

const server = await createServer({
  configFile: false,
  root: import.meta.dirname,
  publicDir: resolve(root, "packages/web/public"),
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
  plugins: [
    {
      name: "retro-demo",
      transformIndexHtml: (html) => html.replace("<!--demo-->", rendered.html),
    },
  ],
});

try {
  await server.listen();
  const origin = server.resolvedUrls?.local[0];
  assert.ok(origin, "Screenshot server did not start");
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      locale: "en-GB",
      timezoneId: "UTC",
      deviceScaleFactor: 1,
    });

    // No remote resources, live room data, or credentials may enter the images.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(origin).origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mkdir(resolve(root, ".github/images"), { recursive: true });

    for (const [file, viewport] of [
      ["board", { width: 1440, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(origin, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );

      if (file === "mobile")
        assert.equal(
          await page
            .locator("#room-sheet")
            .evaluate((element) => element.hasAttribute("open")),
          false,
        );
      await page
        .getByText("Try meeting-free mornings next sprint", { exact: true })
        .waitFor();
      assert.ok(
        await page
          .getByRole("button", { name: "Edit action", exact: true })
          .first()
          .isVisible(),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: resolve(root, `.github/images/${file}.png`),
        animations: "disabled",
      });
    }

    assert.deepEqual(errors, []);
    console.log(
      "Updated desktop and mobile README screenshots from the real app view.",
    );
  } finally {
    await browser.close();
  }
} finally {
  await server.close();
}
