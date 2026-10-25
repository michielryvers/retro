import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Schema } from "effect";
import { Template, templates } from "@retro/domain/Room/Templates";

const Model = Schema.Struct({ selected: Template });
const Message = defineMessageUnion({ Selected: { template: Template } });

const TemplatePickerDefinition = Block.makeDefinition("TemplatePicker", {
  Model,
  Message,
});

const TemplatePickerComposition = TemplatePickerDefinition.makeComposition();

const init = TemplatePickerComposition.makeInit(() => ({
  model: { selected: "mad-sad-glad" },
}));

const update = TemplatePickerComposition.makeUpdate(
  (m, msg, busy: boolean) => ({ model: busy ? m : { selected: msg.template } }),
);

const view = TemplatePickerComposition.makeView.withInputs<{
  readonly busy: boolean;
}>((m, inputs, h) =>
  h.fieldset(
    [h.Class("template-picker")],
    [
      h.legend([], ["Retrospective format"]),
      ...Object.entries(templates).map(([id, template]) =>
        h.label(
          [h.Class(`template-option ${m.selected === id ? "selected" : ""}`)],
          [
            h.input([
              h.Type("radio"),
              h.Name("template"),
              h.Value(id),
              h.Checked(m.selected === id),
              h.Disabled(inputs.busy),
              h.OnChange(() =>
                Message.Selected({
                  template: Schema.decodeUnknownSync(Template)(id),
                }),
              ),
            ]),
            h.strong(
              [h.Class("format-categories")],
              template.title
                .split(" / ")
                .flatMap((name, index) => [
                  ...(index
                    ? [h.span([h.Class("format-separator")], ["/"])]
                    : []),
                  h.span(
                    [h.Class(`format-category format-category-${index}`)],
                    [name],
                  ),
                ]),
            ),
          ],
        ),
      ),
    ],
  ),
);

const prepare = () =>
  TemplatePickerComposition.prepareBlock({ init, update, view });

export const TemplatePickerBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
