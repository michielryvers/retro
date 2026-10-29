import * as Cause from "effect/Cause";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";

import { ApplicationDefinition, Message } from "./definition.ts";

export const Resume = ApplicationDefinition.makeCommand("Resume", {
  args: { roomId: Schema.String, invitation: Schema.Boolean },
  messages: [Message.Entered, Message.NeedsJoin, Message.RoomUnavailable],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return ({ roomId, invitation }) =>
      Effect.gen(function* () {
        const board = yield* api.SharedBoard.get(RoomId.make(roomId));

        return board && !invitation
          ? Message.Entered({ roomId, board })
          : Message.NeedsJoin();
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed(
            Cause.pretty(cause).includes("permanently deleted")
              ? Message.RoomUnavailable()
              : Message.NeedsJoin(),
          ),
        ),
      );
  },
});

export const EnterRoomViewport = ApplicationDefinition.makeCommand(
  "EnterRoomViewport",
  {
    messages: [Message.Notify],
    handler: function* () {
      return () =>
        Effect.promise(
          () =>
            new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
              requestAnimationFrame(() => {
                window.scrollTo({ top: 0, behavior: "instant" });
                resolve(Message.Notify({ text: "" }));
              }),
            ),
        );
    },
  },
);

export const FocusControl = ApplicationDefinition.makeCommand("FocusControl", {
  args: { selector: Schema.String },
  messages: [Message.Notify],
  handler: function* () {
    return ({ selector }) =>
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
            requestAnimationFrame(() => {
              Array.from(document.querySelectorAll<HTMLElement>(selector))
                .find((element) => element.getClientRects().length)
                ?.focus();
              resolve(Message.Notify({ text: "" }));
            }),
          ),
      );
  },
});
