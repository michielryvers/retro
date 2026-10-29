import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema } from "effect";
import { Select } from "@foldkit/ui";
import { BoardState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { controls } from "./controls.ts";

const Model = Schema.Struct({
  selected: Schema.String,
  action: Schema.String,
  actionId: Schema.String,
  actionDraftId: Schema.String,
  owner: Schema.String,
  due: Schema.String,
  busy: Schema.Boolean,
});

const Message = defineMessageUnion({
  Field: {
    field: Schema.Literals(["action", "owner", "due"]),
    value: Schema.String,
  },
  Add: { id: Schema.String },
  Edit: { id: Schema.String },
  Cancel: {},
  Save: {},
  Delete: { id: Schema.String },
  Prepared: { id: Schema.String },
  Saved: {},
  Deleted: {},
  Failed: { reason: Schema.String },
  Focused: { text: Schema.String },
  InformedOfRoomChange: {},
});

const OutMessage = defineMessageUnion({
  Notified: { text: Schema.String },
  Failed: { reason: Schema.String },
});

const ActionEditorDefinition = Block.makeDefinition("ActionEditor", {
  Model,
  Message,
  OutMessage,
});

const ActionEditorComposition = ActionEditorDefinition.makeComposition();

export interface ActionContext {
  readonly roomId: string;
  readonly board: BoardState | null;
  readonly actorId: string;
  readonly busy: boolean;
}

const allowed = (c: ActionContext) =>
  c.board?.phase === "actions" && c.board.adminId === c.actorId;

const blank = {
  selected: "",
  action: "",
  actionId: "",
  actionDraftId: "",
  owner: "",
  due: "",
  busy: false,
};

const Prepare = ActionEditorDefinition.makeCommand("Prepare", {
  messages: [Message.Prepared],
  handler: function* () {
    return () =>
      Effect.sync(() => Message.Prepared({ id: crypto.randomUUID() }));
  },
});

const SaveAction = ActionEditorDefinition.makeCommand("SaveAction", {
  args: {
    roomId: Schema.String,
    id: Schema.String,
    noteId: Schema.String,
    text: Schema.String,
    ownerId: Schema.String,
    dueDate: Schema.String,
  },
  messages: [Message.Saved, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      Effect.gen(function* () {
        yield* api.SaveAction({
          target: RoomId.make(a.roomId),
          commandId: crypto.randomUUID(),
          id: a.id,
          noteId: a.noteId,
          text: a.text,
          ownerId: a.ownerId,
          dueDate: a.dueDate,
        });

        return Message.Saved();
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.catchCause(() =>
          Effect.succeed(
            Message.Failed({
              reason: "Could not save the action. Please try again.",
            }),
          ),
        ),
      );
  },
});

const DeleteAction = ActionEditorDefinition.makeCommand("DeleteAction", {
  args: { roomId: Schema.String, id: Schema.String },
  messages: [Message.Deleted, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      Effect.gen(function* () {
        yield* api.DeleteAction({
          target: RoomId.make(a.roomId),
          commandId: crypto.randomUUID(),
          id: a.id,
        });

        return Message.Deleted();
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.catchCause(() =>
          Effect.succeed(
            Message.Failed({
              reason: "Could not delete the action. Please try again.",
            }),
          ),
        ),
      );
  },
});

export const FocusAction = ActionEditorDefinition.makeCommand("FocusAction", {
  messages: [Message.Focused],
  handler: function* () {
    return () =>
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof Message.Focused>>((resolve) =>
            requestAnimationFrame(() => {
              const input = document.getElementById("action");
              input
                ?.closest(".action-form")
                ?.scrollIntoView({ block: "center" });
              input?.focus({ preventScroll: true });
              resolve(Message.Focused({ text: "" }));
            }),
          ),
      );
  },
});

const init = ActionEditorComposition.makeInit(() => ({ model: blank }));

const save = (m: typeof Model.Type, c: ActionContext, id: string) =>
  SaveAction({
    roomId: c.roomId,
    id,
    noteId: m.selected,
    text: m.action,
    ownerId: m.owner,
    dueDate: m.due,
  });

const update = ActionEditorComposition.makeUpdate.withContext(
  (c: ActionContext) => ({
    Field: (m, { field, value }) => ({
      model: m.busy ? m : { ...m, [field]: value },
    }),
    Add: (m, { id }) => {
      if (!allowed(c) || c.busy || m.busy) return { model: m };

      if (m.selected && m.selected !== id && m.action.trim())
        return {
          model: m,
          outMessage: OutMessage.Notified({
            text: "Save or cancel this action before opening another.",
          }),
        };

      return { model: { ...blank, selected: id }, commands: [FocusAction()] };
    },
    Edit: (m, { id }) => {
      if (!allowed(c) || c.busy || m.busy) return { model: m };
      const a = c.board?.actions.find((a) => a.id === id);

      if (!a) return { model: m };

      if (m.selected && m.action.trim())
        return {
          model: m,
          outMessage: OutMessage.Notified({
            text: "Save or cancel this action first.",
          }),
        };

      return {
        model: {
          ...blank,
          selected: a.noteId,
          actionId: a.id,
          action: a.text,
          owner: a.ownerId,
          due: a.dueDate,
        },
        commands: [FocusAction()],
      };
    },
    Cancel: (m) => ({ model: m.busy ? m : blank }),
    Save: (m) =>
      !allowed(c) || c.busy || m.busy || !m.selected || !m.action.trim()
        ? { model: m }
        : {
            model: { ...m, busy: true },
            commands:
              m.actionId || m.actionDraftId
                ? [save(m, c, m.actionId || m.actionDraftId)]
                : [Prepare()],
          },
    Prepared: (m, { id }) =>
      !allowed(c) || !m.busy
        ? { model: blank }
        : { model: { ...m, actionDraftId: id }, commands: [save(m, c, id)] },
    Delete: (m, { id }) =>
      !allowed(c) || c.busy || m.busy
        ? { model: m }
        : {
            model: { ...m, busy: true },
            commands: [DeleteAction({ roomId: c.roomId, id })],
          },
    Saved: (m) => ({
      model: blank,
      outMessage: OutMessage.Notified({
        text: m.actionId ? "Action updated." : "Action added.",
      }),
    }),
    Deleted: (m) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Notified({ text: "Action deleted." }),
    }),
    Failed: (m, { reason }) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Failed({ reason }),
    }),
    Focused: (m) => ({ model: m }),
    InformedOfRoomChange: (m) => ({ model: allowed(c) ? m : blank }),
  }),
);

const view = ActionEditorComposition.makeView.withInputs<
  ActionContext & {
    readonly mode: "form" | "add" | "controls";
    readonly id: string;
  }
>((m, inputs, h) => {
  const b = inputs.board;

  if (!b || !allowed(inputs)) return null;
  const { button, field, textarea } = controls(h, m.busy || inputs.busy);

  if (inputs.mode === "add")
    return button(
      "Add action",
      Message.Add({ id: inputs.id }),
      "icon-button",
      false,
      "list-plus",
    );

  if (inputs.mode === "controls")
    return h.div(
      [h.Class("action-controls")],
      [
        button(
          "Edit action",
          Message.Edit({ id: inputs.id }),
          "icon-button",
          false,
          "pencil-simple",
        ),
        button(
          "Delete action",
          Message.Delete({ id: inputs.id }),
          "icon-button",
          false,
          "trash",
        ),
      ],
    );

  if (!m.selected || !b.notes.some((n) => n.id === m.selected)) return null;

  return h.form(
    [h.Class("action-form"), h.OnSubmit(Message.Save())],
    [
      textarea(
        "action",
        "What will we do?",
        m.action,
        (value) => Message.Field({ field: "action", value }),
        "A concrete next step",
      ),
      h.div(
        [h.Class("form-row")],
        [
          Select.view(
            {
              id: "owner",
              value: m.owner,
              onChange: (value) => Message.Field({ field: "owner", value }),
              toView: (a) =>
                h.div(
                  [h.Class("field")],
                  [
                    h.label([...a.label], ["Owner"]),
                    h.select(
                      [...a.select],
                      [
                        h.option([h.Value("")], ["Choose an owner"]),
                        ...b.participants.map((p) =>
                          h.option([h.Value(p.id)], [p.name]),
                        ),
                      ],
                    ),
                  ],
                ),
            },
            h,
          ),
          field(
            "due",
            "Due date (optional)",
            m.due,
            (value) => Message.Field({ field: "due", value }),
            "",
            "date",
          ),
        ],
      ),
      h.div(
        [h.Class("action-form-controls")],
        [
          button(
            "Save action",
            Message.Save(),
            "primary",
            m.busy || !m.action.trim(),
            "check",
          ),
          button("Cancel", Message.Cancel(), "secondary", m.busy),
        ],
      ),
    ],
  );
});

const prepare = () =>
  ActionEditorComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(
      Prepare.layer,
      SaveAction.layer,
      DeleteAction.layer,
      FocusAction.layer,
    ),
    operations: { informRoomChange: Message.InformedOfRoomChange },
  });

export const ActionEditorBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
