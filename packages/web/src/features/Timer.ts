import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema, Stream } from "effect";

import { BoardState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { controls } from "./controls.ts";

const Model = Schema.Struct({ now: Schema.Number, busy: Schema.Boolean });

const Message = defineMessageUnion({
  Tick: { now: Schema.Number },
  Requested: {
    operation: Schema.Literals(["start", "pause", "resume", "extend", "stop"]),
    seconds: Schema.Int,
  },
  Completed: { board: Schema.NullOr(BoardState) },
  Failed: { reason: Schema.String },
});

const OutMessage = defineMessageUnion({
  Updated: { board: Schema.NullOr(BoardState), notice: Schema.String },
  Failed: { reason: Schema.String },
});

const TimerDefinition = Block.makeDefinition("Timer", {
  Model,
  Message,
  OutMessage,
});

const TimerComposition = TimerDefinition.makeComposition();

export interface TimerContext {
  readonly roomId: string;
  readonly allowed: boolean;
  readonly busy: boolean;
}

const SetTimer = TimerDefinition.makeCommand("SetTimer", {
  args: {
    roomId: Schema.String,
    operation: Schema.Literals(["start", "pause", "resume", "extend", "stop"]),
    seconds: Schema.Int,
  },
  messages: [Message.Completed, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      Effect.gen(function* () {
        const receipt = yield* api.SetTimer({
          target: RoomId.make(a.roomId),
          operation: a.operation,
          seconds: a.seconds,
        });

        const board = yield* api.SharedBoard.get(RoomId.make(a.roomId), {
          atLeast: receipt,
        });

        return Message.Completed({ board });
      }).pipe(
        Effect.catchCause(() =>
          Effect.succeed(
            Message.Failed({
              reason: "Could not update the timer. Please try again.",
            }),
          ),
        ),
      );
  },
});

const init = TimerComposition.makeInit(() => ({
  model: { now: 0, busy: false },
}));

const update = TimerComposition.makeUpdate((m, msg, context: TimerContext) =>
  Message.match(msg, {
    Tick: ({ now }) => ({ model: { ...m, now } }),
    Requested: ({ operation, seconds }) =>
      !context.allowed || context.busy || m.busy
        ? { model: m }
        : {
            model: { ...m, busy: true },
            commands: [
              SetTimer({ roomId: context.roomId, operation, seconds }),
            ],
          },
    Completed: ({ board }) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Updated({ board, notice: "" }),
    }),
    Failed: ({ reason }) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Failed({ reason }),
    }),
  }),
);

const subscriptions = TimerDefinition.makeSubscriptions((entry) => ({
  clock: entry(
    "clock",
    {},
    {
      messages: [Message.Tick],
      modelToDependencies: () => ({}),
      handler: function* () {
        return () =>
          Stream.concat(
            Stream.fromEffect(
              Effect.sync(() => Message.Tick({ now: Date.now() })),
            ),
            Stream.tick("1 second").pipe(
              Stream.map(() => Message.Tick({ now: Date.now() })),
            ),
          );
      },
    },
  ),
}));

const view = TimerComposition.makeView.withInputs<{
  readonly board: BoardState;
  readonly actorId: string;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly compact?: boolean;
}>((m, inputs, h) => {
  const b = inputs.board;
  const admin = b.adminId === inputs.actorId;
  const { button, icon } = controls(h, m.busy || inputs.busy);

  const timerMs = b.timer?.endsAt
    ? Math.max(0, b.timer.endsAt - m.now)
    : (b.timer?.remainingMs ?? 0);

  const timerSeconds = Math.ceil(timerMs / 1000);
  const timerText = `${Math.floor(timerSeconds / 60)}:${String(timerSeconds % 60).padStart(2, "0")}`;

  const tool = (
    operation: "start" | "pause" | "resume" | "extend" | "stop",
    seconds = 0,
  ) => Message.Requested({ operation, seconds });

  if (inputs.compact)
    return h.span(
      [h.Class("mobile-countdown"), h.AriaLabel("Shared timer")],
      [
        icon("timer"),
        timerText,
        !b.timer?.endsAt ? " · paused" : !timerSeconds ? " · time’s up" : "",
      ],
    );

  return h.section(
    [
      h.Class(`room-timer ${inputs.expanded && admin ? "controls-open" : ""}`),
      h.AriaLabel("Shared session timer"),
    ],
    [
      h.div(
        [h.Class("timer-display")],
        [
          icon("timer"),
          b.timer?.endsAt || timerSeconds ? h.strong([], [timerText]) : null,
          h.span(
            [],
            [
              b.timer?.endsAt
                ? timerSeconds
                  ? "Time remaining"
                  : "Time’s up · continue when ready"
                : timerSeconds
                  ? "Paused"
                  : "Timer",
            ],
          ),
        ],
      ),
      admin
        ? h.div(
            [h.Class("tool-buttons")],
            [
              !timerSeconds
                ? button("5 min", tool("start", 300), "quiet")
                : null,
              !timerSeconds
                ? button("10 min", tool("start", 600), "quiet")
                : null,
              b.timer?.endsAt && timerSeconds
                ? button("Pause", tool("pause"), "secondary")
                : timerSeconds
                  ? button("Resume", tool("resume"), "secondary")
                  : null,
              b.timer?.endsAt || timerSeconds
                ? button("+1 min", tool("extend", 60), "quiet")
                : null,
              b.timer?.endsAt || timerSeconds
                ? button("Clear", tool("stop"), "quiet")
                : null,
            ],
          )
        : null,
    ],
  );
});

const prepare = () =>
  TimerComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    EffectsLayer: Layer.mergeAll(SetTimer.layer, subscriptions.layer),
  });

export const TimerBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
