import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Schema } from "effect";
import { Input } from "@foldkit/ui";

const Model = Schema.Struct({ search: Schema.String, filter: Schema.String });

const Message = defineMessageUnion({
  Search: { value: Schema.String },
  Filter: { value: Schema.String },
});

type Message = typeof Message.Type;

const AdminFiltersDefinition = Block.makeDefinition("AdminFilters", {
  Model,
  Message,
});

const AdminFiltersComposition = AdminFiltersDefinition.makeComposition();

const init = AdminFiltersComposition.makeInit(() => ({
  model: { search: "", filter: "" },
}));

const update = AdminFiltersComposition.makeUpdate((m, msg) =>
  Message.match(msg, {
    Search: ({ value }) => ({ model: { ...m, search: value } }),
    Filter: ({ value }) => ({ model: { ...m, filter: value } }),
  }),
);

const view = AdminFiltersComposition.makeView.withInputs<{
  readonly disabled: boolean;
}>((m, inputs, h) => {
  const input = (
    id: string,
    label: string,
    value: string,
    onInput: (value: string) => Message,
  ) =>
    Input.view(
      {
        id,
        value,
        onInput,
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label(a.label, [label]),
              h.input([
                ...a.input,
                h.Autocomplete("off"),
                h.Disabled(inputs.disabled),
              ]),
            ],
          ),
      },
      h,
    );

  return h.div(
    [h.Class("admin-tools")],
    [
      input("room-search", "Find a room", m.search, (value) =>
        Message.Search({ value }),
      ),
      h.div(
        [
          h.Class("admin-filters"),
          h.Role("group"),
          h.AriaLabel("Filter rooms"),
        ],
        [
          ["", "All rooms"],
          ["active", "In progress"],
          ["closed", "Finished"],
        ].map(([value, label]) =>
          h.button(
            [
              h.Type("button"),
              h.Class(`button ${m.filter === value ? "primary" : "secondary"}`),
              h.AriaPressed(String(m.filter === value)),
              h.OnClick(Message.Filter({ value: value! })),
            ],
            [label!],
          ),
        ),
      ),
    ],
  );
});

const prepare = () =>
  AdminFiltersComposition.prepareBlock({ init, update, view });

export const AdminFiltersBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
