import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { initialRoom } from "../src/Room/RoomState.ts";
import { reconcileDeletion } from "../src/Room/RoomRetention.policy.ts";
import { roomDeletesAt } from "../src/Room/Retention.ts";

const start = Date.parse("2026-01-01T12:00:00Z");
const closed = { ...initialRoom, lifecycle: "created" as const, phase: "closed" as const, closedAt: start };

async function deliverQueuedDeletion(room: typeof initialRoom, requestedAt: number) {
  const operations: string[] = [];

  await Effect.runPromise(reconcileDeletion(
    room, requestedAt,
    Effect.sync(() => operations.push("purge")),
    Effect.sync(() => operations.push("reschedule")),
  ));

  return operations;
}

it("reschedules rather than purging a deletion event queued under the seven-day policy", async () => {
  expect(await deliverQueuedDeletion(closed, start + 7 * 86400000)).toEqual(["reschedule"]);
});

it("allows a new request at the full current deadline", async () => {
  expect(await deliverQueuedDeletion(closed, roomDeletesAt(start))).toEqual(["purge"]);
});

it("ignores queued deletion events for active and uncreated rooms", async () => {
  for (const room of [initialRoom, { ...closed, phase: "write" as const }]) {
    expect(await deliverQueuedDeletion(room, roomDeletesAt(start))).toEqual([]);
  }
});
