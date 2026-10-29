import { explainFailure as explain } from "./failure.ts";
import { ErrorResponse } from "@retro/domain/HttpContracts";
import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema } from "effect";
import { BoardState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { sortByVotes } from "../voteSort.ts";
import { columnsFor } from "@retro/domain/Room/Templates";
import { controls } from "./controls.ts";

const Model = Schema.Struct({
  manageRoom: Schema.Boolean,
  cleanup: Schema.Boolean,
  deleteTitle: Schema.String,
  busy: Schema.Boolean,
});

const Message = defineMessageUnion({
  ManageRoom: {},
  Cleanup: {},
  Field: { value: Schema.String },
  DeleteRoom: {},
  Deleted: {},
  Archive: {},
  Archived: {},
  Export: {},
  Notify: { text: Schema.String },
  Failed: { reason: Schema.String },
  ToggleActions: {},
});

const OutMessage = defineMessageUnion({
  Deleted: {},
  Notified: { text: Schema.String },
  Failed: { reason: Schema.String },
  ToggleActions: {},
});

const LifecycleDefinition = Block.makeDefinition("Lifecycle", {
  Model,
  Message,
  OutMessage,
});

const LifecycleComposition = LifecycleDefinition.makeComposition();

export interface LifecycleContext {
  readonly roomId: string;
  readonly board: BoardState | null;
  readonly actorId: string;
  readonly busy: boolean;
  readonly voteSort: "highest" | "lowest" | "original";
}

export const DeleteRetro = LifecycleDefinition.makeCommand("DeleteRetro", {
  args: { roomId: Schema.String, title: Schema.String },
  messages: [Message.Deleted, Message.Failed],
  handler: function* () {
    return ({ roomId, title }) =>
      Effect.tryPromise(async () => {
        const response = await fetch("/api/room-cleanup", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: roomId, title }),
        });

        if (!response.ok)
          throw new Error(
            Schema.decodeUnknownSync(ErrorResponse)(await response.json())
              .error,
          );
        window.location.assign("/");

        return Message.Deleted();
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(Message.Failed({ reason: explain(error) })),
        ),
      );
  },
});

export const Export = LifecycleDefinition.makeCommand("Export", {
  args: {
    board: BoardState,
    order: Schema.Literals(["highest", "lowest", "original"]),
  },
  messages: [Message.Notify],
  handler: function* () {
    return ({ board: b, order }) =>
      Effect.sync(() => {
        const name = (id: string) =>
          b.participants.find((p) => p.id === id)?.name || "Unassigned";

        const text = [
          `# ${b.title}`,
          "",
          ...columnsFor(b.template).flatMap((c) => [
            `## ${c.title}`,
            ...sortByVotes(
              b.notes.filter((n) => n.column === c.id),
              order,
              (n) => b.scores.find((s) => s.noteId === n.id)?.count ?? 0,
            ).map(
              (n) =>
                `- ${n.text} (${b.scores.find((s) => s.noteId === n.id)?.count ?? 0} ${(b.scores.find((s) => s.noteId === n.id)?.count ?? 0) === 1 ? "vote" : "votes"})`,
            ),
            "",
          ]),
          "## Actions",
          ...b.actions.map(
            (a) =>
              `- ${a.text} — ${name(a.ownerId)}${a.dueDate ? ` · due ${a.dueDate}` : ""}`,
          ),
          "",
        ].join("\n");

        const url = URL.createObjectURL(
          new Blob([text], { type: "text/markdown" }),
        );

        const link = document.createElement("a");
        link.href = url;
        link.download = "retrospective.md";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        return Message.Notify({ text: "Summary downloaded." });
      });
  },
});

const Archive = LifecycleDefinition.makeCommand("Archive", {
  args: { roomId: Schema.String, archived: Schema.Boolean },
  messages: [Message.Archived, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      api
        .ArchiveRoom({
          target: RoomId.make(a.roomId),
          commandId: crypto.randomUUID(),
          archived: a.archived,
        })
        .pipe(
          Effect.as(Message.Archived()),
          Effect.timeout("15 seconds"),
          Effect.catchCause(() =>
            Effect.succeed(
              Message.Failed({
                reason: "Could not update the archive. Please try again.",
              }),
            ),
          ),
        );
  },
});

const init = LifecycleComposition.makeInit(() => ({
  model: { manageRoom: false, cleanup: false, deleteTitle: "", busy: false },
}));

const update = LifecycleComposition.makeUpdate.withContext(
  (c: LifecycleContext) => ({
    ManageRoom: (m) => ({
      model: { ...m, manageRoom: !m.manageRoom, cleanup: false },
    }),
    Cleanup: (m) => ({ model: { ...m, cleanup: !m.cleanup, deleteTitle: "" } }),
    Field: (m, { value }) => ({
      model: m.busy ? m : { ...m, deleteTitle: value },
    }),
    DeleteRoom: (m) =>
      m.busy ||
      c.busy ||
      c.board?.phase !== "closed" ||
      c.board.adminId !== c.actorId ||
      m.deleteTitle !== c.board.title
        ? { model: m }
        : {
            model: { ...m, busy: true },
            commands: [DeleteRetro({ roomId: c.roomId, title: m.deleteTitle })],
          },
    Deleted: (m) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Deleted(),
    }),
    Archive: (m) =>
      m.busy ||
      c.busy ||
      c.board?.phase !== "closed" ||
      c.board.adminId !== c.actorId
        ? { model: m }
        : {
            model: { ...m, busy: true },
            commands: [
              Archive({ roomId: c.roomId, archived: !c.board.archived }),
            ],
          },
    Archived: (m) => ({ model: { ...m, busy: false } }),
    Export: (m) => ({
      model: m,
      commands: c.board ? [Export({ board: c.board, order: c.voteSort })] : [],
    }),
    Notify: (m, { text }) => ({
      model: m,
      outMessage: OutMessage.Notified({ text }),
    }),
    Failed: (m, { reason }) => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Failed({ reason }),
    }),
    ToggleActions: (m) => ({
      model: m,
      outMessage: OutMessage.ToggleActions(),
    }),
  }),
);

const view = LifecycleComposition.makeView.withInputs<
  LifecycleContext & {
    readonly mode: "summary" | "export";
    readonly actionsOnly: boolean;
  }
>((m, inputs, h) => {
  const b = inputs.board;

  if (!b) return null;
  const admin = b.adminId === inputs.actorId;
  const { button, field, icon } = controls(h, m.busy || inputs.busy);

  if (inputs.mode === "export")
    return button(
      "Export",
      Message.Export(),
      "secondary",
      false,
      "download-simple",
    );

  return b.phase === "closed"
    ? h.section(
        [h.Class("closed-summary")],
        [
          icon("check-circle"),
          h.div(
            [],
            [
              h.h1(
                [],
                [
                  b.archived
                    ? "Archived · read-only"
                    : "Retrospective complete",
                ],
              ),
              h.p(
                [h.Class("muted")],
                [
                  `Download before ${new Date(b.deletesAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}. This retro is then deleted automatically.`,
                ],
              ),
              h.a(
                [h.Href("/"), h.Class("home-link")],
                ["Back to retrospectives", icon("arrow-right")],
              ),
              button(
                `${b.actions.length} action ${b.actions.length === 1 ? "item" : "items"}${inputs.actionsOnly ? " · filtered" : ""}`,
                Message.ToggleActions(),
                "quiet action-count",
                !b.actions.length,
                "funnel",
              ),
            ],
          ),
          button(
            "Download summary",
            Message.Export(),
            "primary",
            false,
            "download-simple",
          ),
          admin
            ? button(
                "Manage room",
                Message.ManageRoom(),
                "secondary",
                false,
                "gear",
              )
            : null,
          admin && m.manageRoom
            ? h.div(
                [h.Class("cleanup-actions")],
                [
                  button(
                    b.archived ? "Restore retro" : "Archive retro",
                    Message.Archive(),
                    "secondary",
                    m.busy,
                    "archive",
                  ),
                  h.p(
                    [h.Class("subtle")],
                    [
                      b.archived
                        ? "Read-only until restored."
                        : "Archiving makes the room read-only. You can restore it later.",
                    ],
                  ),
                  button(
                    "Delete retro…",
                    Message.Cleanup(),
                    "secondary",
                    m.busy,
                    "trash",
                  ),
                  m.cleanup
                    ? h.section(
                        [
                          h.Class("cleanup-confirm"),
                          h.AriaLabel("Delete retro permanently"),
                        ],
                        [
                          h.h3([], ["Permanently delete this retro?"]),
                          h.p(
                            [],
                            [
                              "This removes all notes, votes and actions for everyone. The room link will stop working. There is no undo.",
                            ],
                          ),
                          h.p(
                            [],
                            [
                              "Download the summary first and check that the file is saved before continuing.",
                            ],
                          ),
                          button(
                            "Download summary",
                            Message.Export(),
                            "secondary",
                            false,
                            "download-simple",
                          ),
                          field(
                            "deleteTitle",
                            `Type “${b.title}” to confirm`,
                            m.deleteTitle,
                            (value) => Message.Field({ value }),
                          ),
                          button(
                            m.busy ? "Deleting…" : "Permanently delete",
                            Message.DeleteRoom(),
                            "danger",
                            m.busy || m.deleteTitle !== b.title,
                            "trash",
                          ),
                          button(
                            "Cancel",
                            Message.Cleanup(),
                            "secondary",
                            m.busy,
                          ),
                        ],
                      )
                    : null,
                ],
              )
            : null,
        ],
      )
    : null;
});

const prepare = () =>
  LifecycleComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(
      DeleteRetro.layer,
      Export.layer,
      Archive.layer,
    ),
  });

export const LifecycleBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
