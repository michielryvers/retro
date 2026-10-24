import { RoomRetentionLive } from "@retro/domain/Room/RoomRetention.policy";
import { RoomCleanup } from "@retro/domain/Room/RoomCleanup.external";
import * as Redacted from "effect/Redacted";
import { it } from "@effect/vitest";
import { expect } from "vitest";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Retro } from "@retro/domain/Retro.model";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { inviteToken } from "../src/Secrets.ts";
import { SessionLive } from "../src/Session.ts";
import { testPassword } from "../../../scripts/test-access.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(Retro.layer(RoomRetentionLive.pipe(Layer.provide(RoomCleanup.toLayer(Effect.succeed({ remove: () => Effect.die("Unexpected retention cleanup") })))))),
  Layer.provide(Domain.InMemory),
);

const device = (value: string) => ({
  headers: { cookie: `__Host-cg_session=${value.repeat(64)}` },
});

const host = device("a"),
  phone = device("b"),
  laptop = device("c"),
  stranger = device("d");

it.live(
  "requires invite and password, rejoins the same identity and protects private invitations",
  () =>
    Effect.gen(function* () {
      const api = yield* RetroApi.testClient;
      const target = RoomId.make("invited-room");
      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target,
          title: "Invite test",
          name: "Host",
          password: Redacted.make(testPassword),
        },
        host,
      );
      const added = yield* api.InviteParticipant({ target, name: "Sam" }, host);

      const invitations = (yield* api.Invitations.get(target, {
        ...host,
        atLeast: added,
      }))!;

      const person = invitations.people[1]!;

      const token = yield* Effect.promise(() =>
        inviteToken(Redacted.value(invitations.seed), person.id),
      );

      const credentials = {
        target,
        participantId: person.id,
        token: Redacted.make(token),
        password: Redacted.make(testPassword),
      };

      expect(
        (yield* api.SharedBoard.get(target, host))?.participants,
      ).toHaveLength(1);
      expect(
        (yield* api.SharedBoard.get(target, phone).pipe(Effect.flip))._tag,
      ).toBe("Refused");
      expect(
        (yield* api
          .JoinRoom(
            { ...credentials, token: Redacted.make("0".repeat(64)) },
            phone,
          )
          .pipe(Effect.flip))._tag,
      ).toBe("Refused");

      const denied = yield* api.JoinRoom(
        { ...credentials, password: Redacted.make("wrong password") },
        phone,
      );

      expect(
        (yield* api.SharedBoard.get(target, phone).pipe(Effect.flip))._tag,
      ).toBe("Refused");
      expect(denied.reply).toEqual({ joined: false });
      expect((yield* api.JoinRoom(credentials, phone)).reply).toEqual({
        joined: true,
      });
      yield* api.SaveNote(
        { target, id: "private", column: "mad", text: "Only Sam" },
        phone,
      );
      const joined = yield* api.JoinRoom(credentials, laptop);
      const mine = RoomId.make(`${target}:${person.id}`);
      expect(
        (yield* api.MyNotes.get(mine, { ...laptop, atLeast: joined }))?.notes[0]
          ?.text,
      ).toBe("Only Sam");

      const edited = yield* api.SaveNote(
        { target, id: "private", column: "mad", text: "Edited on laptop" },
        laptop,
      );

      expect(
        (yield* api.MyNotes.get(mine, { ...phone, atLeast: edited }))?.notes[0]
          ?.text,
      ).toBe("Edited on laptop");
      expect(
        (yield* api.MyNotes.get(mine, stranger).pipe(Effect.flip))._tag,
      ).toBe("Refused");
      expect(
        (yield* api.Invitations.get(target, laptop).pipe(Effect.flip))._tag,
      ).toBe("Refused");
      expect(
        (yield* api
          .InviteParticipant({ target, name: "Intruder" }, laptop)
          .pipe(Effect.flip))._tag,
      ).toBe("Refused");
      const board = yield* api.SharedBoard.get(target, host);
      expect(board?.participants).toHaveLength(2);

      const history = JSON.stringify(
        yield* api.SharedBoard.list(target, { ...host, take: 100 }),
      );

      for (const secret of [
        JSON.stringify(testPassword),
        Redacted.value(invitations.seed),
        token,
        "passwordHash",
        "passwordSalt",
        "Only Sam",
        "Edited on laptop",
      ])
        expect(history).not.toContain(secret);

      const inviteHistory = yield* api.Invitations.list(target, {
        ...host,
        take: 100,
      });

      expect(inviteHistory.entries).toHaveLength(0);
      yield* api.RevealNotes({ target }, host);
      yield* api.StartVoting({ target }, host);

      const voted = yield* api.SetVote(
        { target, noteId: "private", selected: true },
        phone,
      );

      expect(
        (yield* api.MyNotes.get(mine, { ...laptop, atLeast: voted }))?.votes,
      ).toEqual(["private"]);
      yield* api.SetVote({ target, noteId: "private", selected: true }, laptop);
      const finished = yield* api.FinishVoting({ target }, host);
      expect(
        (yield* api.SharedBoard.get(target, { ...host, atLeast: finished }))
          ?.scores,
      ).toEqual([{ noteId: "private", count: 1 }]);
      // Personal facilitator links restore the role on another device.
      const hostPerson = invitations.people[0]!;

      const hostToken = yield* Effect.promise(() =>
        inviteToken(Redacted.value(invitations.seed), hostPerson.id),
      );

      yield* api.JoinRoom(
        {
          target,
          participantId: hostPerson.id,
          token: Redacted.make(hostToken),
          password: Redacted.make(testPassword),
        },
        stranger,
      );
      const closed = yield* api.CloseRoom({ target }, stranger);
      expect(
        (yield* api.SharedBoard.get(target, { ...stranger, atLeast: closed }))
          ?.phase,
      ).toBe("closed");
    }).pipe(Effect.provide(World)),
);

it.live(
  "persists password throttling across fresh browser sessions and rejects cross-room invites",
  () =>
    Effect.gen(function* () {
      const api = yield* RetroApi.testClient;
      const target = RoomId.make("throttle-room");
      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target,
          title: "Throttle",
          name: "Host",
          password: Redacted.make(testPassword),
        },
        host,
      );
      yield* api.InviteParticipant({ target, name: "Sam" }, host);
      const invitations = (yield* api.Invitations.get(target, host))!;
      const person = invitations.people[1]!;

      const token = yield* Effect.promise(() =>
        inviteToken(Redacted.value(invitations.seed), person.id),
      );

      for (let i = 0; i < 5; i++)
        yield* api.JoinRoom(
          {
            target,
            participantId: person.id,
            token: Redacted.make(token),
            password: Redacted.make("wrong"),
          },
          phone,
        );

      const denied = yield* api
        .JoinRoom(
          {
            target,
            participantId: person.id,
            token: Redacted.make(token),
            password: Redacted.make(testPassword),
          },
          laptop,
        )
        .pipe(Effect.flip);

      expect(denied._tag).toBe("Refused");
      const other = RoomId.make("other-room");
      yield* api.CreateRoom(
        {
          template: "mad-sad-glad",
          target: other,
          title: "Other",
          name: "Host",
          password: Redacted.make(testPassword),
        },
        host,
      );
      expect(
        (yield* api
          .JoinRoom(
            {
              target: other,
              participantId: person.id,
              token: Redacted.make(token),
              password: Redacted.make(testPassword),
            },
            phone,
          )
          .pipe(Effect.flip))._tag,
      ).toBe("Refused");
      expect(
        (yield* api.SharedBoard.get(other, phone).pipe(Effect.flip))._tag,
      ).toBe("Refused");
    }).pipe(Effect.provide(World)),
);

it.live("accepts three-character passwords and refuses shorter passwords", () =>
  Effect.gen(function* () {
    const api = yield* RetroApi.testClient;
    const target = RoomId.make("short-password");
    expect(
      (yield* api
        .CreateRoom(
          {
            target,
            template: "mad-sad-glad",
            title: "Short password",
            name: "Host",
            password: Redacted.make("ab"),
          },
          host,
        )
        .pipe(Effect.flip))._tag,
    ).toBe("Refused");

    const created = yield* api.CreateRoom(
      {
        template: "mad-sad-glad",
        target,
        title: "Short password",
        name: "Host",
        password: Redacted.make("abc"),
      },
      host,
    );

    expect(
      (yield* api.SharedBoard.get(target, { ...host, atLeast: created }))
        ?.title,
    ).toBe("Short password");
  }).pipe(Effect.provide(World)),
);
