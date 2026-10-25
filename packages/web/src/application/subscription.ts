import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { ApplicationDefinition, Message } from "./definition.ts";

export const subscriptions = ApplicationDefinition.makeSubscriptions(
  (entry) => ({
    reconnect: entry(
      "reconnect",
      { active: Schema.Boolean },
      {
        messages: [Message.Retry],
        modelToDependencies: (m) => ({ active: m.entered && !m.connected }),
        handler: function* () {
          return ({ active }) =>
            active
              ? Stream.tick("5 seconds").pipe(
                  Stream.filter(() => navigator.onLine),
                  Stream.map(() => Message.Retry()),
                )
              : Stream.empty;
        },
      },
    ),
    network: entry(
      "network",
      { active: Schema.Boolean },
      {
        messages: [Message.Retry, Message.WatchFailed],
        modelToDependencies: (m) => ({ active: m.entered }),
        handler: function* () {
          return ({ active }) =>
            active
              ? Stream.merge(
                  Stream.fromEventListener(window, "online").pipe(
                    Stream.map(() => Message.Retry()),
                  ),
                  Stream.fromEventListener(window, "offline").pipe(
                    Stream.map(() =>
                      Message.WatchFailed({
                        reason:
                          "You’re offline. Reconnecting when your connection returns.",
                      }),
                    ),
                  ),
                )
              : Stream.empty;
        },
      },
    ),
    focus: entry(
      "focus",
      { active: Schema.Boolean },
      {
        messages: [Message.CheckRoom],
        modelToDependencies: (m) => ({ active: m.entered }),
        handler: function* () {
          return ({ active }) =>
            active
              ? Stream.fromEventListener(window, "focus").pipe(
                  Stream.map(() => Message.CheckRoom()),
                )
              : Stream.empty;
        },
      },
    ),
    notice: entry(
      "notice",
      { text: Schema.String },
      {
        messages: [Message.ClearNotice],
        modelToDependencies: (m) => ({ text: m.notice }),
        handler: function* () {
          return ({ text }) =>
            text
              ? Stream.fromEffect(
                  Effect.sleep("4 seconds").pipe(
                    Effect.as(Message.ClearNotice({ text })),
                  ),
                )
              : Stream.empty;
        },
      },
    ),
    clock: entry(
      "clock",
      { active: Schema.Boolean },
      {
        messages: [Message.Tick],
        modelToDependencies: (m) => ({
          active: Boolean(
            m.entered && m.board?.timer?.endsAt && m.board.phase !== "closed",
          ),
        }),
        handler: function* () {
          return ({ active }) =>
            active
              ? Stream.tick("1 second").pipe(
                  Stream.map(() => Message.Tick({ now: Date.now() })),
                )
              : Stream.empty;
        },
      },
    ),
    board: entry(
      "board",
      { roomId: Schema.String, entered: Schema.Boolean, reconnect: Schema.Int },
      {
        messages: [Message.Board, Message.RoomUnavailable, Message.WatchFailed],
        modelToDependencies: (m) => ({
          roomId: m.roomId,
          entered: m.entered,
          reconnect: m.reconnect,
        }),
        handler: function* () {
          const api = yield* RetroApi.Client;

          return ({ roomId, entered }) =>
            entered
              ? api.SharedBoard.watch(RoomId.make(roomId)).pipe(
                  Stream.map((board) => Message.Board({ board })),
                  Stream.catchCause((e) =>
                    Stream.succeed(
                      Cause.pretty(e).includes("permanently deleted")
                        ? Message.RoomUnavailable()
                        : Message.WatchFailed({
                            reason: "Connection interrupted. Reconnecting…",
                          }),
                    ),
                  ),
                )
              : Stream.empty;
        },
      },
    ),
    mine: entry(
      "mine",
      {
        roomId: Schema.String,
        actorId: Schema.String,
        entered: Schema.Boolean,
        reconnect: Schema.Int,
      },
      {
        messages: [
          Message.Private,
          Message.RoomUnavailable,
          Message.WatchFailed,
        ],
        modelToDependencies: (m) => ({
          roomId: m.roomId,
          actorId: m.actorId,
          entered: m.entered,
          reconnect: m.reconnect,
        }),
        handler: function* () {
          const api = yield* RetroApi.Client;

          return ({ roomId, actorId, entered }) =>
            entered
              ? api.MyNotes.watch(RoomId.make(`${roomId}:${actorId}`)).pipe(
                  Stream.map((state) => Message.Private({ state })),
                  Stream.catchCause((e) =>
                    Stream.succeed(
                      Cause.pretty(e).includes("permanently deleted")
                        ? Message.RoomUnavailable()
                        : Message.WatchFailed({
                            reason: "Connection interrupted. Reconnecting…",
                          }),
                    ),
                  ),
                )
              : Stream.empty;
        },
      },
    ),
  }),
);
