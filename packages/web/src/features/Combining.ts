import { explainFailure as explain } from "./failure.ts";
import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema, Cause } from "effect";
import { BoardState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { controls } from "./controls.ts";

const Model = Schema.Struct({
  dragSource: Schema.String,
  dropTarget: Schema.String,
  busy: Schema.Boolean,
});

const Message = defineMessageUnion({
  DragStart: { id: Schema.String },
  DragEnd: {},
  DragOver: { id: Schema.String },
  Drop: { id: Schema.String },
  Split: { id: Schema.String },
  Combined: { board: BoardState, noteId: Schema.String },
  Separated: { board: Schema.NullOr(BoardState) },
  Failed: { reason: Schema.String },
  InformedOfRoom: {},
});

const OutMessage = defineMessageUnion({
  Updated: {
    board: Schema.NullOr(BoardState),
    noteId: Schema.String,
    notice: Schema.String,
  },
  Failed: { reason: Schema.String },
});

const CombiningDefinition = Block.makeDefinition("Combining", {
  Model,
  Message,
  OutMessage,
});

const CombiningComposition = CombiningDefinition.makeComposition();

export interface CombiningContext {
  readonly roomId: string;
  readonly board: BoardState | null;
  readonly actorId: string;
  readonly busy: boolean;
}

const allowed = (c: CombiningContext) =>
  c.board?.phase === "reveal" && c.board.adminId === c.actorId;

const blank = { dragSource: "", dropTarget: "", busy: false };

export const Combine = CombiningDefinition.makeCommand("Combine", {
  args: {
    roomId: Schema.String,
    sourceId: Schema.String,
    targetId: Schema.String,
  },
  messages: [Message.Combined, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return ({ roomId, sourceId, targetId }) =>
      Effect.gen(function* () {
        const target = RoomId.make(roomId);
        const receipt = yield* api.CombineNotes({ target, sourceId, targetId });
        const board = yield* api.SharedBoard.get(target, { atLeast: receipt });

        return board
          ? Message.Combined({ board, noteId: targetId })
          : Message.Failed({
              reason: "Could not refresh the combined note. Please reload.",
            });
      }).pipe(
        Effect.catchCause((e) =>
          Effect.succeed(
            Message.Failed({
              reason: Cause.pretty(e).includes("permanently deleted")
                ? "This room was permanently deleted."
                : explain(Cause.squash(e)),
            }),
          ),
        ),
      );
  },
});

const Split = CombiningDefinition.makeCommand("Split", {
  args: { roomId: Schema.String, id: Schema.String },
  messages: [Message.Separated, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      Effect.gen(function* () {
        const target = RoomId.make(a.roomId);
        const receipt = yield* api.SplitNote({ target, noteId: a.id });

        return Message.Separated({
          board: yield* api.SharedBoard.get(target, { atLeast: receipt }),
        });
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.catchCause(() =>
          Effect.succeed(
            Message.Failed({
              reason: "Could not separate the notes. Please try again.",
            }),
          ),
        ),
      );
  },
});

const init = CombiningComposition.makeInit(() => ({ model: blank }));

const update = CombiningComposition.makeUpdate.withContext(
  (c: CombiningContext) => ({
    DragStart: (m, { id }) => ({
      model:
        allowed(c) &&
        !m.busy &&
        !c.busy &&
        c.board?.notes.some((n) => n.id === id)
          ? { ...m, dragSource: id, dropTarget: "" }
          : m,
    }),
    DragEnd: (m) => ({ model: { ...m, dragSource: "", dropTarget: "" } }),
    DragOver: (m, { id }) => ({
      model: {
        ...m,
        dropTarget: m.dragSource && m.dragSource !== id ? id : "",
      },
    }),
    Drop: (m, { id }) =>
      !allowed(c) ||
      m.busy ||
      c.busy ||
      !m.dragSource ||
      m.dragSource === id ||
      !c.board?.notes.some((n) => n.id === id)
        ? { model: m }
        : {
            model: { ...blank, busy: true },
            commands: [
              Combine({
                roomId: c.roomId,
                sourceId: m.dragSource,
                targetId: id,
              }),
            ],
          },
    Split: (m, { id }) =>
      !allowed(c) || m.busy || c.busy
        ? { model: m }
        : {
            model: { ...blank, busy: true },
            commands: [Split({ roomId: c.roomId, id })],
          },
    Combined: (m, { board, noteId }) => ({
      model: blank,
      outMessage: OutMessage.Updated({
        board,
        noteId,
        notice: "Notes combined.",
      }),
    }),
    Separated: (m, { board }) => ({
      model: blank,
      outMessage: OutMessage.Updated({
        board,
        noteId: "",
        notice: "Notes separated.",
      }),
    }),
    Failed: (m, { reason }) => ({
      model: { ...blank, busy: false },
      outMessage: OutMessage.Failed({ reason }),
    }),
    InformedOfRoom: (m) => ({
      model:
        allowed(c) && c.board?.notes.some((n) => n.id === m.dragSource)
          ? m
          : { ...m, dragSource: "", dropTarget: "" },
    }),
  }),
);

const view = CombiningComposition.makeView.withInputs<
  CombiningContext & { readonly id: string }
>((m, c, h) =>
  allowed(c)
    ? controls(h, m.busy || c.busy).button(
        "Split notes",
        Message.Split({ id: c.id }),
        "icon-button",
        false,
        "arrows-out",
      )
    : null,
);

const prepare = () =>
  CombiningComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(Combine.layer, Split.layer),
    operations: {
      dragStart: Message.DragStart,
      dragEnd: Message.DragEnd,
      dragOver: Message.DragOver,
      drop: Message.Drop,
      informRoom: Message.InformedOfRoom,
    },
  });

export const CombiningBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
