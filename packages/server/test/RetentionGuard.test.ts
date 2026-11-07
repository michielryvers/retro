import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { purgeWithRetention } from "../src/PurgeRetention.ts";
import { initialRoom } from "@retro/domain/Room/RoomState";
import { deletionDue, RETENTION_YEAR_MS } from "@retro/domain/Room/Retention";

async function purgeFixture(room: typeof initialRoom | null, automatic = true, tombstone = false) {
  let purged = false;

  const result = await Effect.runPromise(purgeWithRetention(room, automatic, tombstone,
    Effect.sync(() => {
      purged = true;

      return { participants: ["host"] };
    }),
  ));

  return { purged, result };
}

const closed = () => ({
  ...initialRoom, lifecycle: "created" as const, phase: "closed" as const,
  title: "Existing retro", adminId: "host", createdAt: Date.now() - 14 * 86400000, closedAt: Date.now() - 7 * 86400000,
});

it("blocks physical purge from an already-queued legacy automatic cleanup", async () => {
  expect(await purgeFixture(closed())).toEqual({ purged: false, result: { participants: [], retained: true } });
});

it("never automatically purges an active, uncreated or missing room", async () => {
  for (const room of [null, initialRoom, { ...closed(), phase: "write" as const }]) {
    expect((await purgeFixture(room)).purged).toBe(false);
  }
});

it("allows automatic purge only after the full retention deadline", async () => {
  const room = { ...closed(), closedAt: Date.now() - RETENTION_YEAR_MS - 1000 };

  expect((await purgeFixture(room)).purged).toBe(true);
});

it("keeps explicit administrator deletion and in-progress tombstone cleanup working", async () => {
  expect((await purgeFixture(closed(), false)).purged).toBe(true);
  expect((await purgeFixture(closed(), true, true)).purged).toBe(true);
});

it("requires a valid closure timestamp and respects the exact deadline", () => {
  const room = closed();
  const at = room.closedAt + RETENTION_YEAR_MS;

  expect(deletionDue(room, at - 1)).toBe(false);
  expect(deletionDue(room, at)).toBe(true);

  for (const closedAt of [0, NaN, Infinity]) expect(deletionDue({ ...room, closedAt }, at)).toBe(false);
});
