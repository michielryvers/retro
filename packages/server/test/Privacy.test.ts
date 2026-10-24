import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import * as Redacted from "effect/Redacted";
import { joinInvited, testPassword } from "../../../scripts/test-access.ts";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Retro } from "@retro/domain/Retro.model";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { SessionLive } from "../src/Session.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(RoomCleanup.toLayer(Effect.succeed({ remove: () => Effect.die("Unexpected retention cleanup") })))))),
  Layer.provide(Domain.InMemory),
);

const host = "a".repeat(64),
  guest = "b".repeat(64),
  outsider = "c".repeat(64);

const options = (token: string) => ({
  headers: { cookie: `__Host-cg_session=${token}` },
});

it.live("guards private views and prevents event-history disclosure", () =>
  Effect.gen(function* () {
    const api = yield* RetroApi.testClient;
    const room = RoomId.make("privacy");
    yield* api.CreateRoom(
      {
        template: "mad-sad-glad",
        target: room,
        password: Redacted.make(testPassword),
        title: "Privacy test",
        name: "Host",
      },
      options(host),
    );

    const guestId = yield* joinInvited(
      api,
      room,
      "Guest",
      options(host),
      options(guest),
    );

    yield* api.SaveNote(
      { target: room, id: "secret", column: "mad", text: "PRIVATE SENTENCE" },
      options(guest),
    );
    const board = yield* api.SharedBoard.get(room, options(host));
    expect(board?.notes).toEqual([]);

    const history = yield* api.SharedBoard.list(room, {
      ...options(host),
      take: 100,
    });

    expect(JSON.stringify(history)).not.toContain("PRIVATE SENTENCE");
    expect(JSON.stringify(history)).not.toContain("NoteSaved");
    const guestKey = RoomId.make(`${room}:${guestId}`);
    const mine = yield* api.MyNotes.get(guestKey, options(guest));
    expect(mine?.notes[0]?.text).toBe("PRIVATE SENTENCE");

    const denied = yield* api.MyNotes.get(guestKey, options(host)).pipe(
      Effect.flip,
    );

    expect(denied._tag).toBe("Refused");

    const noMembership = yield* api.SharedBoard.get(
      room,
      options(outsider),
    ).pipe(Effect.flip);

    expect(noMembership._tag).toBe("Refused");
    const noSession = yield* api.SharedBoard.get(room).pipe(Effect.flip);
    expect(noSession._tag).toBe("Unauthorized");
    yield* api.RevealNotes({ target: room }, options(host));
    yield* api.StartVoting({ target: room }, options(host));
    yield* api.SetVote(
      { target: room, noteId: "secret", selected: true },
      options(guest),
    );

    const votingHistory = yield* api.SharedBoard.list(room, {
      ...options(host),
      take: 100,
    });

    expect(JSON.stringify(votingHistory)).not.toContain("VoteRecorded");
    const votingBoard = yield* api.SharedBoard.get(room, options(host));
    expect(votingBoard?.scores).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(World)),
);

it.live(
  "deduplicates retries and prevents cross-session admin escalation",
  () =>
    Effect.gen(function* () {
      const api = yield* RetroApi.testClient;
      const room = RoomId.make("retry");
      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target: room,
          password: Redacted.make(testPassword),
          title: "Retry test",
          name: "Host",
        },
        options(host),
      );

      yield* joinInvited(api, room, "Guest", options(host), options(guest));

      const cmd = {
        target: room,
        id: "note",
        column: "glad" as const,
        text: "One note",
        commandId: "stable-retry",
      };

      const first = yield* api.SaveNote(cmd, options(guest));
      const again = yield* api.SaveNote(cmd, options(guest));
      expect(again.version).toBe(first.version);

      const refused = yield* api
        .RevealNotes({ target: room }, options(guest))
        .pipe(Effect.flip);

      expect(refused._tag).toBe("Refused");
    }).pipe(Effect.scoped, Effect.provide(World)),
);

it.live(
  "shares voting completion without choices and withdraws it when a vote is removed",
  () =>
    Effect.gen(function* () {
      const api = yield* RetroApi.testClient;
      const room = RoomId.make("voting-progress");
      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target: room,
          password: Redacted.make(testPassword),
          title: "Progress",
          name: "Host",
        },
        options(host),
      );

      const guestId = yield* joinInvited(
        api,
        room,
        "Guest",
        options(host),
        options(guest),
      );

      yield* api.SaveNote(
        { target: room, id: "n", column: "glad", text: "A note" },
        options(host),
      );
      yield* api.RevealNotes({ target: room }, options(host));
      yield* api.StartVoting({ target: room }, options(host));
      yield* api.SetVote(
        { target: room, noteId: "n", selected: true },
        options(guest),
      );
      const board = yield* api.SharedBoard.get(room, options(host));
      expect(board?.voters).toEqual([guestId]);
      expect(board?.scores).toEqual([]);

      const history = yield* api.SharedBoard.list(room, {
        ...options(host),
        take: 100,
      });

      expect(JSON.stringify(history)).not.toContain("VoteRecorded");
      expect(JSON.stringify(history)).not.toContain('"selected":true');
      expect(JSON.stringify(history)).not.toContain('"votes":');
      yield* api.SetVote(
        { target: room, noteId: "n", selected: false },
        options(guest),
      );
      expect((yield* api.SharedBoard.get(room, options(host)))?.voters).toEqual(
        [],
      );
    }).pipe(Effect.scoped, Effect.provide(World)),
);
