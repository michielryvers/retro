import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Schema, Stream } from "effect";

const Model = Schema.Struct({ text: Schema.String });

const Message = defineMessageUnion({
  InformedOfNotice: { text: Schema.String },
  Elapsed: { text: Schema.String },
});

const NoticeDefinition = Block.makeDefinition("Notice", { Model, Message });
const NoticeComposition = NoticeDefinition.makeComposition();
const init = NoticeComposition.makeInit(() => ({ model: { text: "" } }));

const update = NoticeComposition.makeUpdate({
  InformedOfNotice: (model, { text }) => ({ model: { ...model, text } }),
  Elapsed: (model, { text }) => ({
    model: { ...model, text: model.text === text ? "" : model.text },
  }),
});

const subscriptions = NoticeDefinition.makeSubscriptions((entry) => ({
  dismiss: entry(
    "dismiss",
    { text: Schema.String },
    {
      messages: [Message.Elapsed],
      modelToDependencies: (m) => ({ text: m.text }),
      handler: function* () {
        return ({ text }) =>
          text
            ? Stream.fromEffect(
                Effect.sleep("4 seconds").pipe(
                  Effect.as(Message.Elapsed({ text })),
                ),
              )
            : Stream.empty;
      },
    },
  ),
}));

const view = NoticeComposition.makeView((model, h) =>
  model.text
    ? h.p(
        [h.Role("status"), h.Class("notice")],
        [h.i([h.Class("ph ph-check-circle"), h.AriaHidden(true)]), model.text],
      )
    : null,
);

const prepare = () =>
  NoticeComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    EffectsLayer: subscriptions.layer,
    operations: { informNotice: Message.InformedOfNotice },
  });

export const NoticeBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
