import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema } from "effect";
import { Textarea } from "@foldkit/ui";
import { BoardState, Column } from "@retro/domain/Room/Values";
import { columnsFor } from "@retro/domain/Room/Templates";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { controls } from "./controls.ts";

const Model = Schema.Struct({
  editor: Schema.NullOr(Column),
  editId: Schema.String,
  draft: Schema.String,
  drafts: Schema.Record(Schema.String, Schema.String),
  draftIds: Schema.Record(Schema.String, Schema.String),
  busy: Schema.Boolean,
  revision: Schema.Int,
});

const Message = defineMessageUnion({
  Changed: { value: Schema.String },
  Edit: { column: Column, id: Schema.String, text: Schema.String },
  Cancel: {},
  Save: {},
  Delete: {},
  Prepared: { id: Schema.String },
  Saved: {},
  Failed: { reason: Schema.String },
  Loaded: {
    drafts: Schema.Record(Schema.String, Schema.String),
    draftIds: Schema.Record(Schema.String, Schema.String),
    revision: Schema.Int,
  },
  Persisted: {},
  BackupFailed: {},
  InformedOfColumn: { column: Column },
  InformedOfRoom: { load: Schema.Boolean },
});

const OutMessage = defineMessageUnion({
  Saved: {},
  Notified: { text: Schema.String },
  Failed: { reason: Schema.String },
  Editing: { column: Column },
});

const NotesDefinition = Block.makeDefinition("Notes", {
  Model,
  Message,
  OutMessage,
});

const NotesComposition = NotesDefinition.makeComposition();

export interface NotesContext {
  readonly roomId: string;
  readonly actorId: string;
  readonly board: BoardState | null;
  readonly column: string;
  readonly busy: boolean;
}

const editable = (c: NotesContext) =>
  c.board?.phase === "write" &&
  !c.board.participants.find((p) => p.id === c.actorId)?.ready;

const blank = {
  editor: null,
  editId: "",
  draft: "",
  drafts: {},
  draftIds: {},
  busy: false,
  revision: 0,
};

const keyFor = (roomId: string, actorId: string) =>
  `cg_drafts_v2:${roomId}:${actorId}`;

const Stored = Schema.Struct({
  drafts: Schema.Record(Schema.String, Schema.String),
  ids: Schema.Record(Schema.String, Schema.String),
});

export const Load = NotesDefinition.makeCommand("Load", {
  args: { roomId: Schema.String, actorId: Schema.String, revision: Schema.Int },
  messages: [Message.Loaded, Message.BackupFailed],
  handler: function* () {
    return (a) =>
      Effect.sync(() => {
        try {
          const raw = localStorage.getItem(keyFor(a.roomId, a.actorId));

          const saved = raw
            ? Schema.decodeUnknownSync(Stored)(JSON.parse(raw))
            : { drafts: {}, ids: {} };

          return Message.Loaded({
            drafts: saved.drafts,
            draftIds: saved.ids,
            revision: a.revision,
          });
        } catch {
          return Message.BackupFailed();
        }
      });
  },
});

export const Persist = NotesDefinition.makeCommand("Persist", {
  args: {
    roomId: Schema.String,
    actorId: Schema.String,
    drafts: Schema.Record(Schema.String, Schema.String),
    draftIds: Schema.Record(Schema.String, Schema.String),
  },
  messages: [Message.Persisted, Message.BackupFailed],
  handler: function* () {
    return (a) =>
      Effect.sync(() => {
        try {
          const key = keyFor(a.roomId, a.actorId);

          if (Object.values(a.drafts).some(Boolean))
            localStorage.setItem(
              key,
              JSON.stringify({ drafts: a.drafts, ids: a.draftIds }),
            );
          else localStorage.removeItem(key);

          return Message.Persisted();
        } catch {
          return Message.BackupFailed();
        }
      });
  },
});

const Prepare = NotesDefinition.makeCommand("Prepare", {
  messages: [Message.Prepared],
  handler: function* () {
    return () =>
      Effect.sync(() => Message.Prepared({ id: crypto.randomUUID() }));
  },
});

const SaveNote = NotesDefinition.makeCommand("SaveNote", {
  args: {
    roomId: Schema.String,
    id: Schema.String,
    column: Column,
    text: Schema.String,
  },
  messages: [Message.Saved, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      api
        .SaveNote({
          target: RoomId.make(a.roomId),
          commandId: crypto.randomUUID(),
          id: a.id,
          column: a.column,
          text: a.text,
        })
        .pipe(
          Effect.as(Message.Saved()),
          Effect.timeout("15 seconds"),
          Effect.catchCause(() =>
            Effect.succeed(
              Message.Failed({
                reason: "Could not save the note. Please try again.",
              }),
            ),
          ),
        );
  },
});

const DeleteNote = NotesDefinition.makeCommand("DeleteNote", {
  args: { roomId: Schema.String, id: Schema.String },
  messages: [Message.Saved, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      api
        .DeleteNote({
          target: RoomId.make(a.roomId),
          commandId: crypto.randomUUID(),
          id: a.id,
        })
        .pipe(
          Effect.as(Message.Saved()),
          Effect.timeout("15 seconds"),
          Effect.catchCause(() =>
            Effect.succeed(
              Message.Failed({
                reason: "Could not delete the note. Please try again.",
              }),
            ),
          ),
        );
  },
});

const persist = (m: typeof Model.Type, c: NotesContext) =>
  Persist({
    roomId: c.roomId,
    actorId: c.actorId,
    drafts: m.drafts,
    draftIds: m.draftIds,
  });

const save = (m: typeof Model.Type, c: NotesContext, id: string) =>
  SaveNote({
    roomId: c.roomId,
    id,
    column: m.editor ?? c.column,
    text: m.draft,
  });

const init = NotesComposition.makeInit(() => ({ model: blank }));

const update = NotesComposition.makeUpdate((m, msg, c: NotesContext) =>
  Message.match(msg, {
    Changed: ({ value }) => {
      if (m.busy || c.busy || !editable(c)) return { model: m };

      const model = {
        ...m,
        draft: value,
        revision: m.revision + 1,
        drafts: m.editId
          ? m.drafts
          : { ...m.drafts, [m.editor ?? c.column]: value },
      };

      return { model, commands: [persist(model, c)] };
    },
    Edit: ({ column, id, text }) => {
      if (m.busy || c.busy || !editable(c)) return { model: m };

      if (m.editId && m.editId !== id)
        return {
          model: m,
          outMessage: OutMessage.Notified({
            text: "Save or cancel your edit before opening another note.",
          }),
        };

      return {
        model: { ...m, editor: column, editId: id, draft: text },
        outMessage: OutMessage.Editing({ column }),
      };
    },
    Cancel: () => {
      if (m.busy) return { model: m };
      const column = m.editor ?? c.column;
      const drafts = m.editId ? m.drafts : { ...m.drafts, [column]: "" };

      const model = {
        ...m,
        editor: null,
        editId: "",
        draft: drafts[column] ?? "",
        drafts,
        draftIds: m.editId ? m.draftIds : { ...m.draftIds, [column]: "" },
        revision: m.revision + 1,
      };

      return { model, commands: [persist(model, c)] };
    },
    Save: () => {
      if (m.busy || c.busy || !editable(c) || !m.draft.trim())
        return { model: m };
      const id = m.editId || m.draftIds[m.editor ?? c.column];

      return {
        model: { ...m, busy: true },
        commands: id ? [save(m, c, id)] : [Prepare()],
      };
    },
    Prepared: ({ id }) => {
      if (!m.busy || !editable(c)) return { model: { ...m, busy: false } };

      const model = {
        ...m,
        draftIds: { ...m.draftIds, [m.editor ?? c.column]: id },
      };

      return { model, commands: [persist(model, c), save(model, c, id)] };
    },
    Delete: () =>
      !m.editId || m.busy || c.busy || !editable(c)
        ? { model: m }
        : {
            model: { ...m, busy: true },
            commands: [DeleteNote({ roomId: c.roomId, id: m.editId })],
          },
    Saved: () => {
      const column = m.editor ?? c.column;
      const drafts = m.editId ? m.drafts : { ...m.drafts, [column]: "" };

      const model = {
        ...m,
        busy: false,
        editor: null,
        editId: "",
        drafts,
        draftIds: m.editId ? m.draftIds : { ...m.draftIds, [column]: "" },
        draft: drafts[column] ?? "",
        revision: m.revision + 1,
      };

      return {
        model,
        commands: [persist(model, c)],
        outMessage: OutMessage.Saved(),
      };
    },
    Failed: ({ reason }) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Failed({ reason }),
    }),
    Loaded: (a) =>
      a.revision !== m.revision
        ? { model: m }
        : {
            model: {
              ...m,
              drafts: a.drafts,
              draftIds: a.draftIds,
              draft: a.drafts[c.column] ?? "",
            },
          },
    Persisted: () => ({ model: m }),
    BackupFailed: () => ({
      model: m,
      outMessage: OutMessage.Notified({
        text: "Draft backup unavailable. Keep this tab open until you save.",
      }),
    }),
    InformedOfColumn: ({ column }) => ({
      model: {
        ...m,
        draft: m.drafts[column] ?? "",
        editor: m.editor ? column : null,
      },
    }),
    InformedOfRoom: ({ load }) =>
      c.board?.phase === "closed" || !c.board
        ? { model: blank, commands: [persist(blank, c)] }
        : load && c.board.phase === "write"
          ? {
              model: m,
              commands: [
                Load({
                  roomId: c.roomId,
                  actorId: c.actorId,
                  revision: m.revision,
                }),
              ],
            }
          : { model: m },
  }),
);

const view = NotesComposition.makeView.withInputs<
  NotesContext & {
    readonly mode: "form" | "edit";
    readonly category: string;
    readonly note?: { id: string; text: string };
  }
>((m, inputs, h) => {
  if (!editable(inputs)) return null;

  const c = columnsFor(inputs.board?.template).find(
    (c) => c.id === inputs.category,
  );

  if (!c) return null;
  const { button, icon } = controls(h, m.busy || inputs.busy);

  if (inputs.mode === "edit" && inputs.note)
    return button(
      "Edit",
      Message.Edit({
        column: c.id,
        id: inputs.note.id,
        text: inputs.note.text,
      }),
      "icon-button",
      false,
      "pencil-simple",
    );

  const textarea = (
    id: "draft",
    label: string,
    value: string,
    placeholder: string,
  ) =>
    Textarea.view(
      {
        id,
        value,
        placeholder,
        rows: 3,
        onInput: (value) => Message.Changed({ value }),
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label([...a.label, h.Class("sr-only")], [label]),
              h.textarea([
                ...a.textarea,
                h.Maxlength(2000),
                h.Disabled(m.busy || inputs.busy),
              ]),
            ],
          ),
      },
      h,
    );

  return h.form(
    [
      h.Class(`note-editor ${!m.editor ? "automatic-composer" : ""}`),
      h.OnSubmit(Message.Save()),
    ],
    [
      h.div(
        [h.Class("composer-sheet")],
        [
          h.span([h.Class("composer-icon")], [icon(c.icon)]),
          textarea(
            "draft",
            `Your ${c.title} note`,
            m.draft,
            "What’s on your mind?",
          ),
        ],
      ),
      h.div(
        [h.Class("editor-actions")],
        [
          h.p(
            [h.Class("composer-privacy")],
            [icon("lock-simple"), "Private until reveal"],
          ),
          m.editId || m.draft
            ? button("Cancel", Message.Cancel(), "quiet")
            : null,
          m.editId
            ? button("Delete", Message.Delete(), "danger-quiet", false, "trash")
            : null,
          button(
            m.busy ? "Saving…" : m.editId ? "Save changes" : "Add note",
            Message.Save(),
            "primary",
            !m.draft.trim(),
            m.editId ? "check" : "plus",
          ),
        ],
      ),
    ],
  );
});

const prepare = () =>
  NotesComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(
      Load.layer,
      Persist.layer,
      Prepare.layer,
      SaveNote.layer,
      DeleteNote.layer,
    ),
    operations: {
      informColumn: Message.InformedOfColumn,
      informRoom: Message.InformedOfRoom,
    },
  });

export const NotesBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
