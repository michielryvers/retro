import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { migrate } from "@alchemy.run/cloudflare/Domain/Version";

it("renames the existing Durable Object classes rather than recreating room data", async () => {
  const legacy = ["RetroRoomAggregate", "SharedBoardView", "MyNotesView", "InvitationsView", "RoomSummaryView", "RoomRetentionPolicy"];

  const renamed = await Effect.runPromise(migrate({
    scriptName: "retro-backend", deployed: undefined,
    deployedClasses: new Set(legacy),
    classes: legacy.map((name) => ({ model: "CommonGround", className: `CommonGround.${name}`, legacyName: name, legacyData: true })),
  }));

  expect(renamed).toEqual(legacy.map((name) => ({ from: name, to: `CommonGround.${name}` })));
});
