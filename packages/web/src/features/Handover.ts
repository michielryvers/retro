import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Schema } from "effect";
import { Select } from "@foldkit/ui";
import { BoardState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { controls } from "./controls.ts";

const Model = Schema.Struct({ selected: Schema.String, busy: Schema.Boolean });

const Message = defineMessageUnion({
  Selected: { value: Schema.String },
  Requested: {},
  Completed: { board: Schema.NullOr(BoardState) },
  Failed: { reason: Schema.String },
});

const OutMessage = defineMessageUnion({
  Updated: { board: Schema.NullOr(BoardState), notice: Schema.String },
  Failed: { reason: Schema.String },
});

const HandoverDefinition = Block.makeDefinition("Handover", {
  Model,
  Message,
  OutMessage,
});

const HandoverComposition = HandoverDefinition.makeComposition();

export interface HandoverContext {
  readonly roomId: string;
  readonly allowed: boolean;
  readonly busy: boolean;
}

const HandOver = HandoverDefinition.makeCommand("HandOver", {
  args: { roomId: Schema.String, participantId: Schema.String },
  messages: [Message.Completed, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      Effect.gen(function* () {
        const receipt = yield* api.Handover({
          target: RoomId.make(a.roomId),
          participantId: a.participantId,
        });

        const board = yield* api.SharedBoard.get(RoomId.make(a.roomId), {
          atLeast: receipt,
        });

        return Message.Completed({ board });
      }).pipe(
        Effect.catchCause(() =>
          Effect.succeed(
            Message.Failed({
              reason: "Could not hand over facilitation. Please try again.",
            }),
          ),
        ),
      );
  },
});

const init = HandoverComposition.makeInit(() => ({
  model: { selected: "", busy: false },
}));

const update = HandoverComposition.makeUpdate(
  (m, msg, context: HandoverContext) =>
    Message.match(msg, {
      Selected: ({ value }) => ({
        model: m.busy ? m : { ...m, selected: value },
      }),
      Requested: () =>
        !context.allowed || context.busy || m.busy || !m.selected
          ? { model: m }
          : {
              model: { ...m, busy: true },
              commands: [
                HandOver({ roomId: context.roomId, participantId: m.selected }),
              ],
            },
      Completed: ({ board }) => ({
        model: { ...m, busy: false, selected: "" },
        outMessage: OutMessage.Updated({
          board,
          notice: "Facilitation handed over.",
        }),
      }),
      Failed: ({ reason }) => ({
        model: { ...m, busy: false },
        outMessage: OutMessage.Failed({ reason }),
      }),
    }),
);

const view = HandoverComposition.makeView.withInputs<{
  readonly board: BoardState;
  readonly actorId: string;
  readonly expanded: boolean;
  readonly busy: boolean;
  readonly compact?: boolean;
}>((m, inputs, h) => {
  const b = inputs.board;

  const { button } = controls(h, m.busy || inputs.busy);
  const tool = (_action: string) => Message.Requested();

  return h.section(
    [h.Class("room-tools"), h.AriaLabel("Room controls")],
    [
      h.div(
        [],
        [
          h.h3([], ["Hand over facilitation"]),
          h.p(
            [h.Class("subtle")],
            ["The selected teammate gets control immediately."],
          ),
          Select.view(
            {
              id: "handover-to",
              value: m.selected,
              onChange: (value) => Message.Selected({ value }),
              toView: (a) =>
                h.div(
                  [h.Class("field")],
                  [
                    h.label([...a.label], ["Next facilitator"]),
                    h.select(
                      [...a.select],
                      [
                        h.option([h.Value("")], ["Choose a teammate"]),
                        ...b.participants
                          .filter((p) => p.id !== inputs.actorId)
                          .map((p) => h.option([h.Value(p.id)], [p.name])),
                      ],
                    ),
                  ],
                ),
            },
            h,
          ),
          button(
            "Hand over control",
            tool("handover"),
            "secondary",
            !m.selected,
          ),
        ],
      ),
    ],
  );
});

const prepare = () =>
  HandoverComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: HandOver.layer,
  });

export const HandoverBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
