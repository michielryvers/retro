import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Schema } from "effect";
import { Input } from "@foldkit/ui";

const Model = Schema.Struct({ value: Schema.String, visible: Schema.Boolean });

const Message = defineMessageUnion({
  Changed: { value: Schema.String },
  Toggle: {},
  Cleared: {},
});

const PasswordInputDefinition = Block.makeDefinition("PasswordInput", {
  Model,
  Message,
});

const PasswordInputComposition = PasswordInputDefinition.makeComposition();
const blank = { value: "", visible: false };
const init = PasswordInputComposition.makeInit(() => ({ model: blank }));

const update = PasswordInputComposition.makeUpdate.withContext(
  (busy: boolean) => ({
    Changed: (m, { value }) => ({ model: busy ? m : { ...m, value } }),
    Toggle: (m) => ({ model: busy ? m : { ...m, visible: !m.visible } }),
    Cleared: () => ({ model: blank }),
  }),
);

const view = PasswordInputComposition.makeView.withInputs<{
  readonly busy: boolean;
  readonly joining: boolean;
}>((m, inputs, h) =>
  Input.view(
    {
      id: "password",
      value: m.value,
      type: m.visible ? "text" : "password",
      placeholder: inputs.joining
        ? "Password from your facilitator"
        : "At least 3 characters",
      onInput: (value) => Message.Changed({ value }),
      toView: (a) =>
        h.div(
          [h.Class("field")],
          [
            h.label(a.label, ["Room password"]),
            h.div(
              [h.Class("input-control")],
              [
                h.input([
                  ...a.input,
                  h.Disabled(inputs.busy),
                  h.Maxlength(500),
                ]),
                h.button(
                  [
                    h.Type("button"),
                    h.Class("password-toggle"),
                    h.AriaLabel(m.visible ? "Hide password" : "Show password"),
                    h.Disabled(inputs.busy),
                    h.OnClick(Message.Toggle()),
                  ],
                  [
                    h.i([
                      h.Class(`ph ph-${m.visible ? "eye-slash" : "eye"}`),
                      h.AriaHidden(true),
                    ]),
                  ],
                ),
              ],
            ),
          ],
        ),
    },
    h,
  ),
);

const prepare = () =>
  PasswordInputComposition.prepareBlock({
    init,
    update,
    view,
    operations: { clear: Message.Cleared },
  });

export const PasswordInputBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
