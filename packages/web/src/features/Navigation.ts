import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Schema, Match } from "effect";
import { Select } from "@foldkit/ui";
import { BoardState, PrivateState, Column } from "@retro/domain/Room/Values";
import { columnsFor } from "@retro/domain/Room/Templates";
import { controls } from "./controls.ts";

const Model = Schema.Struct({
  mobileColumn: Column,
  categoryDirection: Schema.Literals(["next", "previous", "none"]),
  actionsOnly: Schema.Boolean,
  voteSort: Schema.Literals(["highest", "lowest", "original"]),
  phase: Schema.String,
});

const Message = defineMessageUnion({
  MobileColumn: { column: Column },
  ToggleActions: {},
  VoteSort: { order: Schema.Literals(["highest", "lowest", "original"]) },
  InformedOfRoom: {},
  FocusColumn: { column: Column },
});

const OutMessage = defineMessageUnion({
  Selected: { column: Column },
  Notified: { text: Schema.String },
});

const NavigationDefinition = Block.makeDefinition("Navigation", {
  Model,
  Message,
  OutMessage,
});

const NavigationComposition = NavigationDefinition.makeComposition();

export interface NavigationContext {
  readonly board: BoardState | null;
  readonly private: PrivateState;
  readonly busy: boolean;
  readonly editingAction: boolean;
  readonly editingNote: string | null;
}

const init = NavigationComposition.makeInit(() => ({
  model: {
    mobileColumn: columnsFor()[0]!.id,
    categoryDirection: "none",
    actionsOnly: false,
    voteSort: "highest",
    phase: "",
  },
}));

const update = NavigationComposition.makeUpdate(
  (m, msg, c: NavigationContext) =>
    Message.match(msg, {
      MobileColumn: ({ column }) => {
        if (
          c.busy ||
          column === m.mobileColumn ||
          !columnsFor(c.board?.template).some((x) => x.id === column)
        )
          return { model: m };

        if (c.editingAction)
          return {
            model: m,
            outMessage: OutMessage.Notified({
              text: "Save or cancel this action before switching categories.",
            }),
          };

        if (c.editingNote && c.editingNote !== column)
          return {
            model: m,
            outMessage: OutMessage.Notified({
              text: "Save or cancel your edit before switching categories.",
            }),
          };
        const columns = columnsFor(c.board?.template);

        return {
          model: {
            ...m,
            mobileColumn: column,
            categoryDirection:
              columns.findIndex((x) => x.id === column) >
              columns.findIndex((x) => x.id === m.mobileColumn)
                ? ("next" as const)
                : ("previous" as const),
          },
          outMessage: OutMessage.Selected({ column }),
        };
      },
      ToggleActions: () => {
        if (
          c.editingAction ||
          !c.board ||
          !["actions", "closed"].includes(c.board.phase)
        )
          return { model: m };

        const first = c.board.notes.find((n) =>
          c.board?.actions.some((a) => a.noteId === n.id),
        );

        return {
          model: {
            ...m,
            actionsOnly: !m.actionsOnly,
            mobileColumn:
              !m.actionsOnly && first ? first.column : m.mobileColumn,
          },
        };
      },
      VoteSort: ({ order }) => ({ model: { ...m, voteSort: order } }),
      InformedOfRoom: () => ({
        model: {
          ...m,
          mobileColumn: columnsFor(c.board?.template).some(
            (x) => x.id === m.mobileColumn,
          )
            ? m.mobileColumn
            : columnsFor(c.board?.template)[0]!.id,
          voteSort:
            c.board?.phase === "actions" && m.phase !== "actions"
              ? "highest"
              : m.voteSort,
          phase: c.board?.phase ?? "",
        },
      }),
      FocusColumn: ({ column }) => ({ model: { ...m, mobileColumn: column } }),
    }),
);

const view = NavigationComposition.makeView.withInputs<
  NavigationContext & {
    readonly mode: "navigation" | "add";
    readonly column?: string;
  }
>((m, inputs, h) => {
  const b = inputs.board;

  if (!b) return null;
  const { button, icon } = controls(h, inputs.busy);

  if (inputs.mode === "add")
    return button(
      "Add a note",
      Message.MobileColumn({ column: inputs.column ?? m.mobileColumn }),
      "add-note",
      false,
      "plus",
    );
  const columns = columnsFor(b.template);
  const resultsVisible = b.phase === "actions" || b.phase === "closed";
  const allNotes = b.phase === "write" ? inputs.private.notes : b.notes;

  const visibleNotes = m.actionsOnly
    ? allNotes.filter((n) => b.actions.some((a) => a.noteId === n.id))
    : allNotes;

  const columnCount = (id: string) =>
    m.actionsOnly
      ? visibleNotes.filter((n) => n.column === id).length
      : (b.tally[id] ?? 0);

  return h.div(
    [h.Class("board-navigation")],
    [
      resultsVisible && m.actionsOnly
        ? button(
            "Show all notes",
            Message.ToggleActions(),
            "secondary action-filter-reset",
            inputs.editingAction,
            "x",
          )
        : null,
      resultsVisible
        ? Select.view(
            {
              id: "vote-sort",
              value: m.voteSort,
              onChange: (value) =>
                Message.VoteSort({
                  order: Match.value(value).pipe(
                    Match.when("lowest", () => "lowest" as const),
                    Match.when("original", () => "original" as const),
                    Match.orElse(() => "highest" as const),
                  ),
                }),
              toView: (a) =>
                h.div(
                  [h.Class("sort-control")],
                  [
                    h.label([...a.label], ["Sort by"]),
                    icon("sort-descending"),
                    h.select(
                      [...a.select],
                      [
                        h.option([h.Value("highest")], ["Most votes first"]),
                        h.option([h.Value("lowest")], ["Fewest votes first"]),
                        h.option([h.Value("original")], ["Original order"]),
                      ],
                    ),
                  ],
                ),
            },
            h,
          )
        : null,
      h.nav(
        [h.Class("column-tabs"), h.AriaLabel("Note columns")],
        columns.map((c) =>
          h.button(
            [
              h.Class(`${c.tone} ${m.mobileColumn === c.id ? "active" : ""}`),
              h.OnClick(Message.MobileColumn({ column: c.id })),
              h.Disabled(inputs.busy),
              h.AriaPressed(String(m.mobileColumn === c.id)),
            ],
            [icon(c.icon), c.title, h.span([], [String(columnCount(c.id))])],
          ),
        ),
      ),
    ],
  );
});

const prepare = () =>
  NavigationComposition.prepareBlock({
    init,
    update,
    view,
    operations: {
      informRoom: Message.InformedOfRoom,
      focusColumn: Message.FocusColumn,
      toggleActions: Message.ToggleActions,
    },
  });

export const NavigationBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
