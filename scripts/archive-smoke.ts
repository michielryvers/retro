// Local only: verifies restoration after deleting its own disposable source room.
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { mkdir } from "node:fs/promises";
import { RetroApi } from "../packages/domain/src/RetroApi.api.ts";
import { RoomId } from "../packages/domain/src/Room/Room.id.ts";
import {
  SessionResponse,
  RoomSummaries,
} from "../packages/domain/src/HttpContracts.ts";
import { decodeArchive } from "../packages/domain/src/RetroArchive.ts";
import { joinInvited, testPassword } from "./test-access.ts";

const origin = process.argv[2] ?? "http://localhost:5187";

assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Local fixtures only",
);

const target = RoomId.make(crypto.randomUUID());
const title = `Archive round trip ${target}`;

const session = async () => {
  const r = await fetch(`${origin}/api/session`, { method: "POST" });

  return {
    ...Schema.decodeUnknownSync(SessionResponse)(await r.json()),
    headers: { cookie: r.headers.get("set-cookie")!.split(";")[0]! },
  };
};

const host = await session();
const guest = await session();

const remove = async (id: string) => {
  const r = await fetch(`${origin}/admin/api/rooms`, {
    method: "DELETE",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ id, title }),
  });

  assert.equal(r.status, 200);
};

const exported = async (id: string) => {
  const r = await fetch(`${origin}/admin/api/export?id=${id}`);
  assert.equal(r.status, 200);

  return decodeArchive(await r.json());
};

let archiveId = "";
let sourceDeleted = false;

try {
  await Effect.runPromise(
    Effect.gen(function* () {
      const api = yield* RetroApi.client;
      yield* api.CreateRoom(target, { title, name: "Alex", template: "keep-drop-try", password: Redacted.make(testPassword) }, host);
      yield* api.SetVoteLimit(target, { limit: 5 }, host);
      guest.id = yield* joinInvited(api, target, "Sam", host, guest);
      yield* api.SaveNote(target, { id: "a", column: "keep", text: "Pair programming helped us ship." }, host);
      yield* api.SaveNote(target, { id: "b", column: "keep", text: "Keep pairing on tricky changes." }, guest);
      yield* api.SaveNote(target, { id: "c", column: "try", text: "A shorter planning meeting." }, guest);

      const early = yield* Effect.promise(() =>
        fetch(`${origin}/admin/api/export?id=${target}`),
      );

      assert.equal(early.status, 409);
      yield* api.RevealNotes(target, {}, host);
      yield* api.CombineNotes(target, { sourceId: "b", targetId: "a" }, host);
      yield* api.StartVoting(target, {}, host);
      yield* api.SetVote(target, { noteId: "a", selected: true }, guest);
      yield* api.SetVote(target, { noteId: "a", selected: true }, host);
      yield* api.FinishVoting(target, {}, host);
      yield* api.SaveAction(target, { id: "action", noteId: "a", text: "Schedule weekly pairing", ownerId: guest.id, dueDate: "2026-12-01" }, host);
      yield* api.CloseRoom(target, {}, host);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Domain.protocolHttp(`${origin}/api`).pipe(
          Layer.provide(FetchHttpClient.layer),
        ),
      ),
    ),
  );
  const before = await exported(target);
  assert.equal(before.notes.length, 3);
  assert.equal(before.combinations.length, 1);
  assert.equal(before.votes.length, 2);
  assert.equal(before.voteLimit, 5);
  assert.equal(before.actions[0]?.ownerId, guest.id);
  assert.equal(before.participants.length, 2);
  await remove(target);
  sourceDeleted = true;
  assert.equal(
    (await fetch(`${origin}/admin/api/export?id=${target}`)).status,
    409,
  );

  const restore = async () => {
    const r = await fetch(`${origin}/admin/api/import`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(before),
    });

    assert.equal(r.status, 200);

    return Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      await r.json(),
    ).id;
  };

  archiveId = await restore();
  assert.notEqual(archiveId, target);
  assert.equal(await restore(), archiveId);
  assert.deepEqual(await exported(archiveId), before);

  const rooms = Schema.decodeUnknownSync(RoomSummaries)(
    await (await fetch(`${origin}/admin/api/rooms`)).json(),
  );

  assert.equal(rooms.filter((r) => r.id === archiveId).length, 1);
  assert.equal(rooms.find((r) => r.id === archiveId)?.imported, true);
  assert.equal(rooms.find((r) => r.id === archiveId)?.notes, 2);
  assert.equal(
    rooms.some((r) => r.id === target),
    false,
  );

  if (process.argv.includes("--keep")) {
    await mkdir("artifacts", { recursive: true });
    await Bun.write("artifacts/archive-roundtrip.json", JSON.stringify(before));
    await Bun.write(
      "artifacts/archive-fixture.json",
      JSON.stringify({ id: archiveId, title }),
    );
  }

  console.log(
    "Passed export → source deletion → import → identical re-export, grouping, votes, action ownership and idempotency checks.",
  );
} finally {
  if (!sourceDeleted) await remove(target);

  if (archiveId && !process.argv.includes("--keep")) await remove(archiveId);
}
