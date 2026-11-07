// Synthetic local-only fixture: seed against the previous release, restart the
// same Alchemy stage with this release, then verify without rewriting rooms.
import assert from "node:assert/strict";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { BoardState, PrivateState } from "@retro/domain/Room/Values";
import { RETENTION_YEAR_MS } from "@retro/domain/Room/Retention";

const mode = Schema.decodeUnknownSync(Schema.Literals(["seed", "verify"]))(process.argv[2]);
const filename = process.argv[3];
const origin = new URL(process.argv[4] ?? "http://localhost:5187");

if (!filename) throw new Error("Specify a fixture file outside the repository");

if (!["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("This synthetic migration check only runs locally");

const Fixture = Schema.Struct({
  active: RoomId, closed: RoomId,
  activeBoard: BoardState, closedBoard: BoardState, privateNotes: PrivateState,
});

const host = { headers: { cookie: `__Host-cg_session=${"e".repeat(64)}` } };

await Effect.runPromise(Effect.gen(function* () {
  const api = yield* RetroApi.client;

  if (mode === "seed") {
    const active = RoomId.make(crypto.randomUUID());
    const closed = RoomId.make(crypto.randomUUID());

    for (const target of [active, closed]) {
      yield* api.CreateRoom(target, { title: `Retention migration ${target}`, name: "Synthetic host", template: "mad-sad-glad", password: Redacted.make("synthetic-password") }, host);
      yield* api.SaveNote(target, { id: "note", column: "mad", text: "Synthetic private note preserved across upgrade" }, host);
    }

    yield* api.RevealNotes(closed, {}, host);
    yield* api.StartVoting(closed, {}, host);
    yield* api.SetVote(closed, { noteId: "note", selected: true }, host);
    yield* api.FinishVoting(closed, {}, host);
    yield* api.SaveAction(closed, { id: "action", noteId: "note", text: "Review this action next time", ownerId: "", dueDate: "2027-01-01" }, host);
    const receipt = yield* api.CloseRoom(closed, {}, host);
    const activeBoard = (yield* api.SharedBoard.get(active, host))!;
    const closedBoard = (yield* api.SharedBoard.get(closed, { ...host, atLeast: receipt }))!;
    const privateNotes = (yield* api.MyNotes.get(RoomId.make(`${active}:${activeBoard.adminId}`), host))!;

    yield* Effect.promise(() => Bun.write(filename, JSON.stringify({ active, closed, activeBoard, closedBoard, privateNotes })));
    console.log("Saved synthetic active/private and closed/voted/action fixtures. Restart the SAME local stage with the new release, then run verify.");
  } else {
    const fixture = Schema.decodeUnknownSync(Fixture)(yield* Effect.promise(() => Bun.file(filename).json()));
    const activeBoard = yield* api.SharedBoard.get(fixture.active, host);
    const closedBoard = yield* api.SharedBoard.get(fixture.closed, host);
    const privateNotes = yield* api.MyNotes.get(RoomId.make(`${fixture.active}:${fixture.activeBoard.adminId}`), host);

    assert.deepEqual(activeBoard, fixture.activeBoard);
    assert.deepEqual(privateNotes, fixture.privateNotes);
    assert.ok(closedBoard);
    assert.deepEqual({ ...closedBoard, deletesAt: fixture.closedBoard.deletesAt }, fixture.closedBoard);
    assert.equal(closedBoard.deletesAt, fixture.closedBoard.deletesAt - 7 * 86400000 + RETENTION_YEAR_MS);
    console.log("Existing room IDs, grants, private notes, votes, actions and closed-board contents survived; the old seven-day deadline now reads as 365 days.");
  }
}).pipe(
  Effect.provide(Domain.protocolHttp(`${origin.origin}/api`)),
  Effect.provide(FetchHttpClient.layer),
  Effect.scoped,
));
