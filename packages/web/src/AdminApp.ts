import {
  ARCHIVE_MAX_BYTES,
  RetroArchive,
  decodeArchive,
} from "@retro/domain/RetroArchive";
import { combinedNotes } from "@retro/domain/Room/Combination";
import {
  RoomSummaries as Rooms,
  DeleteResponse,
} from "@retro/domain/HttpContracts";
import * as Match from "effect/Match";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Command, Runtime, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import type { HtmlBuilder, Document } from "foldkit/html";
import { Button, Input } from "@foldkit/ui";
import { templates } from "@retro/domain/Room/Templates";

const Model = Schema.Struct({
  transferBusy: Schema.Boolean,
  preview: Schema.NullOr(RetroArchive),
  importPreview: Schema.Boolean,
  rooms: Rooms,
  pending: Rooms,
  bulkTotal: Schema.Int,
  loading: Schema.Boolean,
  deleting: Schema.Boolean,
  search: Schema.String,
  filter: Schema.String,
  selected: Schema.String,
  confirmation: Schema.String,
  error: Schema.String,
  notice: Schema.String,
});

type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  PickArchive: {},
  Preview: { archive: RetroArchive, importing: Schema.Boolean },
  DismissPreview: {},
  ImportArchive: {},
  Imported: { id: Schema.String },
  ExportArchive: { id: Schema.String },
  InspectArchive: { id: Schema.String },
  TransferDone: { notice: Schema.String },
  Loaded: { rooms: Rooms },
  Failed: { error: Schema.String },
  Refresh: {},
  Search: { value: Schema.String },
  Filter: { value: Schema.String },
  Select: { id: Schema.String },
  Confirm: { value: Schema.String },
  Delete: {},
  DeleteAll: {},
  Deleted: { id: Schema.String },
});

type Message = typeof Message.Type;

const Load = Command.define("LoadAdminRooms", {
  messages: [Message.Loaded, Message.Failed],
  execute: Effect.tryPromise(async () => {
    const response = await fetch("/admin/api/rooms", { cache: "no-store" });

    if (!response.ok) throw new Error();

    return Message.Loaded({
      rooms: Schema.decodeUnknownSync(Rooms)(await response.json()),
    });
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        Message.Failed({
          error:
            "Couldn’t load the rooms. Refresh to try again. If your session expired, reload this page to sign in.",
        }),
      ),
    ),
  ),
});

const Delete = Command.define("DeleteAdminRoom", {
  args: { id: Schema.String, title: Schema.String },
  messages: [Message.Deleted, Message.Failed],
  execute: ({ id, title }) =>
    Effect.tryPromise(async () => {
      const response = await fetch("/admin/api/rooms", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });

      const result = Schema.decodeUnknownSync(DeleteResponse)(
        await response.json(),
      );

      if (!response.ok || !result.deleted) throw new Error();

      return Message.Deleted({ id });
    }).pipe(
      Effect.catch(() =>
        Effect.succeed(
          Message.Failed({
            error:
              "Deletion could not finish. Refresh and retry to complete cleanup.",
          }),
        ),
      ),
    ),
});

const transferError = (cause: unknown) => {
  const error = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;

  return Message.Failed({ error: error instanceof Error ? error.message : "Transfer failed. Please try again." });
};

const readArchive = async (id: string) => {
  const response = await fetch(
    `/admin/api/export?id=${encodeURIComponent(id)}`,
    { cache: "no-store" },
  );

  if (!response.ok)
    throw new Error(
      "Couldn’t read this finished retro. Refresh and try again.",
    );

  return decodeArchive(await response.json());
};

const PickArchive = Command.define("PickRetroArchive", {
  messages: [Message.Preview, Message.TransferDone, Message.Failed],
  execute: Effect.tryPromise(async () => {
    const file = await new Promise<File | undefined>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => resolve(input.files?.[0]), {
        once: true,
      });
      input.addEventListener("cancel", () => resolve(undefined), {
        once: true,
      });
      input.click();
    });

    if (!file) return Message.TransferDone({ notice: "" });

    if (file.size > ARCHIVE_MAX_BYTES)
      throw new Error("This archive is too large (maximum 1.8 MB).");

    try {
      return Message.Preview({
        archive: decodeArchive(JSON.parse(await file.text())),
        importing: true,
      });
    } catch {
      throw new Error(
        "Choose a version 1 retro JSON export from administration. Markdown summaries cannot be imported.",
      );
    }
  }).pipe(Effect.catch((error) => Effect.succeed(transferError(error)))),
});

const ExportArchive = Command.define("ExportRetroArchive", {
  args: { id: Schema.String },
  messages: [Message.TransferDone, Message.Failed],
  execute: ({ id }) =>
    Effect.tryPromise(async () => {
      const archive = await readArchive(id);

      const url = URL.createObjectURL(
        new Blob([JSON.stringify(archive)], { type: "application/json" }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = `retro-${id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      return Message.TransferDone({ notice: "JSON export downloaded." });
    }).pipe(Effect.catch((error) => Effect.succeed(transferError(error)))),
});

const InspectArchive = Command.define("InspectRetroArchive", {
  args: { id: Schema.String },
  messages: [Message.Preview, Message.Failed],
  execute: ({ id }) =>
    Effect.tryPromise(async () =>
      Message.Preview({ archive: await readArchive(id), importing: false }),
    ).pipe(Effect.catch((error) => Effect.succeed(transferError(error)))),
});

const ImportArchive = Command.define("ImportRetroArchive", {
  args: { archive: RetroArchive },
  messages: [Message.Imported, Message.Failed],
  execute: ({ archive }) =>
    Effect.tryPromise(async () => {
      const response = await fetch("/admin/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(archive),
      });

      if (!response.ok)
        throw new Error(
          "Import could not finish. You can safely retry this file.",
        );

      const result = Schema.decodeUnknownSync(
        Schema.Struct({ id: Schema.String }),
      )(await response.json());

      return Message.Imported(result);
    }).pipe(Effect.catch((error) => Effect.succeed(transferError(error)))),
});

export const update = (
  m: Model,
  msg: Message,
): Update.Return<Model, Message> => {
  return Match.value(msg).pipe(
    Match.tagsExhaustive({
      PickArchive: (): Update.Return<Model, Message> =>
        m.transferBusy || m.deleting || m.loading
          ? { model: m }
          : {
              model: { ...m, transferBusy: true, error: "", notice: "", selected: "", confirmation: "" },
              commands: [PickArchive()],
            },
      Preview: (msg): Update.Return<Model, Message> => ({
        model: {
          ...m,
          transferBusy: false,
          preview: msg.archive,
          importPreview: msg.importing,
          error: "",
        },
      }),
      DismissPreview: (): Update.Return<Model, Message> =>
        m.transferBusy ? { model: m } : { model: { ...m, preview: null } },
      ImportArchive: (): Update.Return<Model, Message> =>
        !m.preview || !m.importPreview || m.transferBusy || m.deleting
          ? { model: m }
          : {
              model: { ...m, transferBusy: true, error: "" },
              commands: [ImportArchive({ archive: m.preview })],
            },
      Imported: (): Update.Return<Model, Message> => ({
        model: {
          ...m,
          transferBusy: false,
          preview: null,
          loading: true,
          notice:
            "Historical retro saved. Repeated uploads of the same content create no duplicates.",
        },
        commands: [Load()],
      }),
      ExportArchive: (msg): Update.Return<Model, Message> =>
        m.transferBusy || m.deleting
          ? { model: m }
          : {
              model: { ...m, transferBusy: true, error: "" },
              commands: [ExportArchive({ id: msg.id })],
            },
      InspectArchive: (msg): Update.Return<Model, Message> =>
        m.transferBusy || m.deleting
          ? { model: m }
          : {
              model: { ...m, transferBusy: true, error: "" },
              commands: [InspectArchive({ id: msg.id })],
            },
      TransferDone: (msg): Update.Return<Model, Message> => ({
        model: { ...m, transferBusy: false, notice: msg.notice },
      }),
      Loaded: (msg): Update.Return<Model, Message> => {
        return { model: { ...m, rooms: msg.rooms, loading: false, error: "" } };
      },
      Failed: (msg): Update.Return<Model, Message> => {
        return {
          model: {
            ...m,
            loading: false,
            deleting: false,
            transferBusy: false,
            error: msg.error,
          },
        };
      },
      Refresh: (): Update.Return<Model, Message> => {
        if (m.deleting) return { model: m };

        return {
          model: { ...m, loading: true, error: "" },
          commands: [Load()],
        };
      },
      Search: (msg): Update.Return<Model, Message> => {
        return { model: { ...m, search: msg.value } };
      },
      Filter: (msg): Update.Return<Model, Message> => {
        return { model: { ...m, filter: msg.value } };
      },
      Select: (msg): Update.Return<Model, Message> => {
        if (m.deleting || m.loading) return { model: m };

        return {
          model: {
            ...m,
            selected: msg.id,
            pending: [],
            bulkTotal: 0,
            confirmation: "",
            error: "",
            notice: "",
          },
        };
      },
      Confirm: (msg): Update.Return<Model, Message> => {
        return { model: { ...m, confirmation: msg.value } };
      },
      Delete: (): Update.Return<Model, Message> => {
        const room = m.rooms.find((r) => r.id === m.selected);

        if (!room || m.deleting || m.confirmation !== room.title)
          return { model: m };

        return {
          model: { ...m, deleting: true, error: "" },
          commands: [Delete({ id: room.id, title: room.title })],
        };
      },
      DeleteAll: (): Update.Return<Model, Message> => {
        const room = m.rooms[0];

        if (
          !room ||
          m.loading ||
          m.deleting ||
          m.selected !== "__all__" ||
          m.confirmation !== "DELETE ALL"
        )
          return { model: m };

        return {
          model: {
            ...m,
            deleting: true,
            pending: m.rooms,
            bulkTotal: m.rooms.length,
            error: "",
            notice: "",
          },
          commands: [Delete({ id: room.id, title: room.title })],
        };
      },
      Deleted: (msg): Update.Return<Model, Message> => {
        if (m.selected === "__all__") {
          const pending = m.pending.filter((room) => room.id !== msg.id);
          const next = pending[0];

          return {
            model: {
              ...m,
              rooms: m.rooms.filter((room) => room.id !== msg.id),
              pending,
              deleting: Boolean(next),
              selected: next ? "__all__" : "",
              confirmation: next ? m.confirmation : "",
              notice: next
                ? `Deleted ${m.bulkTotal - pending.length} of ${m.bulkTotal} rooms.`
                : `Permanently deleted ${m.bulkTotal} ${m.bulkTotal === 1 ? "room" : "rooms"}.`,
            },
            commands: next
              ? [Delete({ id: next.id, title: next.title })]
              : [Load()],
          };
        }

        return {
          model: {
            ...m,
            deleting: false,
            selected: "",
            confirmation: "",
            rooms: m.rooms.filter((r) => r.id !== msg.id),
            notice:
              "Room permanently deleted. Its invite link no longer works.",
          },
        };
      },
    }),
  );
};

const view = (m: Model, h: HtmlBuilder<Message>): Document => {
  const button = (
    label: string,
    message: Message,
    style = "secondary",
    disabled = false,
  ) =>
    Button.view(
      {
        isDisabled: disabled || m.transferBusy,
        onClick: message,
        toView: (a) =>
          h.button([...a.button, h.Class(`button ${style}`)], [label]),
      },
      h,
    );

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
                h.Disabled(m.deleting),
              ]),
            ],
          ),
      },
      h,
    );

  const rooms = m.rooms.filter(
    (r) =>
      (!m.filter ||
        (m.filter === "active"
          ? !["closed", "deleting"].includes(r.phase)
          : r.phase === m.filter)) &&
      `${r.title} ${r.id}`.toLowerCase().includes(m.search.toLowerCase()),
  );

  const date = (value: number | null) =>
    value
      ? new Date(value).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

  const phases = new Map<string, string>(
    Object.entries({
      write: "Writing",
      reveal: "Revealed",
      vote: "Voting",
      actions: "Actions",
      closed: "Finished",
      deleting: "Cleanup pending",
    }),
  );

  return {
    title: "Room administration",
    body: h.div(
      [h.Class("admin-page")],
      [
        h.header(
          [h.Class("admin-header")],
          [
            h.a([h.Href("/"), h.Class("brand")], ["Retrospectives"]),
            h.a([h.Href("/")], ["Back to main site ↗"]),
          ],
        ),
        h.main(
          [],
          [
            h.div(
              [h.Class("admin-heading")],
              [
                h.div([], [h.h1([], ["Room overview"])]),
                button(
                  m.transferBusy ? "Working…" : "Import JSON",
                  Message.PickArchive(),
                  "primary",
                  m.deleting || m.loading,
                ),
                button(
                  "Delete all rooms",
                  Message.Select({ id: "__all__" }),
                  "danger-outline",
                  m.loading || m.deleting || !m.rooms.length,
                ),
                button(
                  m.loading ? "Refreshing…" : "Refresh",
                  Message.Refresh(),
                  "secondary",
                  m.loading || m.deleting,
                ),
              ],
            ),

            h.div(
              [h.Class("admin-stats")],
              [
                [String(m.rooms.length), "Total rooms"],
                [
                  String(
                    m.rooms.filter(
                      (r) => !["closed", "deleting"].includes(r.phase),
                    ).length,
                  ),
                  "In progress",
                ],
                [
                  String(m.rooms.filter((r) => r.phase === "closed").length),
                  "Finished",
                ],
              ].map(([n, label]) =>
                h.div([], [h.strong([], [n!]), h.span([], [label!])]),
              ),
            ),
            m.selected === "__all__"
              ? h.section(
                  [
                    h.Class("delete-confirm"),
                    h.AriaLabel("Confirm deletion of all rooms"),
                  ],
                  [
                    h.h2(
                      [],
                      [
                        `Permanently delete all ${m.deleting ? m.bulkTotal : m.rooms.length} rooms?`,
                      ],
                    ),
                    h.p(
                      [],
                      [
                        "Includes active and archived rooms, regardless of search or filters. Everyone will be disconnected and all notes, votes and actions removed. This cannot be undone.",
                      ],
                    ),
                    input(
                      "confirm-all",
                      "Type DELETE ALL to confirm",
                      m.confirmation,
                      (value) => Message.Confirm({ value }),
                    ),
                    h.div(
                      [h.Class("admin-confirm-buttons")],
                      [
                        button(
                          "Cancel",
                          Message.Select({ id: "" }),
                          "secondary",
                          m.deleting,
                        ),
                        button(
                          m.deleting
                            ? "Deleting…"
                            : "Permanently delete all rooms",
                          Message.DeleteAll(),
                          "danger",
                          m.deleting ||
                            m.loading ||
                            m.confirmation !== "DELETE ALL" ||
                            !m.rooms.length,
                        ),
                      ],
                    ),
                  ],
                )
              : null,
            h.div(
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
                        h.Class(
                          `button ${m.filter === value ? "primary" : "secondary"}`,
                        ),
                        h.AriaPressed(String(m.filter === value)),
                        h.OnClick(Message.Filter({ value: value! })),
                      ],
                      [label!],
                    ),
                  ),
                ),
              ],
            ),
            m.error
              ? h.p([h.Class("error"), h.Role("alert")], [m.error])
              : null,
            m.notice
              ? h.p([h.Class("notice"), h.Role("status")], [m.notice])
              : null,
            h.p(
              [h.Class("subtle"), h.Role("status")],
              [
                m.loading
                  ? "Loading rooms…"
                  : `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"} · Most recently active first`,
              ],
            ),
            m.preview
              ? h.section(
                  [
                    h.Class("admin-archive-preview"),
                    h.AriaLabel("Retro archive preview"),
                  ],
                  [
                    h.h2([], [m.preview.title]),
                    h.p(
                      [h.Class("subtle")],
                      [
                        `${m.preview.participants.length} people · ${m.preview.notes.length} original notes · ${m.preview.votes.length} votes · ${m.preview.actions.length} actions · Finished ${date(m.preview.closedAt)}`,
                      ],
                    ),
                    m.importPreview
                      ? h.p(
                          [],
                          [
                            "Import as a read-only historical retro. No existing rooms will change. Login links and passwords are not restored.",
                          ],
                        )
                      : null,
                    h.div(
                      [h.Class("admin-confirm-buttons")],
                      [
                        button("Close", Message.DismissPreview(), "secondary"),
                        m.importPreview
                          ? button(
                              m.transferBusy ? "Importing…" : "Import retro",
                              Message.ImportArchive(),
                              "primary",
                              m.deleting,
                            )
                          : null,
                      ],
                    ),
                    ...m.preview.columns.map((column) =>
                      h.section(
                        [],
                        [
                          h.h3([], [column.title]),
                          ...combinedNotes(
                            m.preview!.notes,
                            m.preview!.combinations,
                          )
                            .filter((note) => note.column === column.id)
                            .map((note) =>
                              h.article(
                                [h.Class("archive-note")],
                                [
                                  h.p(
                                    [h.Class("archive-note-text")],
                                    [note.text],
                                  ),
                                  h.p(
                                    [h.Class("subtle")],
                                    [
                                      `${m.preview!.votes.filter((v) => v.noteId === note.id).length} votes · ${(note.parts ?? [note]).map((part) => m.preview!.participants.find((p) => p.id === part.authorId)?.name ?? "Unknown").join(", ")}`,
                                    ],
                                  ),
                                  ...m
                                    .preview!.actions.filter(
                                      (a) => a.noteId === note.id,
                                    )
                                    .map((action) =>
                                      h.div(
                                        [h.Class("archive-action")],
                                        [
                                          h.strong([], [action.text]),
                                          h.p(
                                            [h.Class("subtle")],
                                            [
                                              m.preview!.participants.find(
                                                (p) => p.id === action.ownerId,
                                              )?.name ?? "Unassigned",
                                              action.dueDate
                                                ? ` · Due ${action.dueDate}`
                                                : "",
                                            ],
                                          ),
                                        ],
                                      ),
                                    ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                )
              : null,
            ...rooms.map((r) =>
              h.article(
                [h.Class("admin-room")],
                [
                  h.div(
                    [h.Class("admin-room-heading")],
                    [
                      h.div(
                        [],
                        [
                          h.span(
                            [h.Class(`phase-tag ${r.phase}`)],
                            [
                              r.imported
                                ? "Imported · Read-only"
                                : (phases.get(r.phase) ?? r.phase),
                            ],
                          ),
                          h.h2([], [r.title]),
                          h.p(
                            [h.Class("subtle")],
                            [
                              Object.entries(templates).find(
                                ([key]) => key === r.template,
                              )?.[1].title ?? r.template,
                            ],
                          ),
                        ],
                      ),
                      h.div(
                        [h.Class("admin-room-actions")],
                        [
                          r.phase === "closed"
                            ? button(
                                "View",
                                Message.InspectArchive({ id: r.id }),
                                "secondary",
                                m.deleting,
                              )
                            : null,
                          r.phase === "closed"
                            ? button(
                                "Export JSON",
                                Message.ExportArchive({ id: r.id }),
                                "secondary",
                                m.deleting,
                              )
                            : null,
                          button(
                            "Delete room",
                            Message.Select({ id: r.id }),
                            "danger-outline",
                            m.deleting,
                          ),
                        ],
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class("admin-room-counts")],
                    [
                      h.span(
                        [],
                        [
                          `${r.participants} ${r.participants === 1 ? "person" : "people"}`,
                        ],
                      ),
                      h.span(
                        [],
                        [`${r.notes} ${r.notes === 1 ? "note" : "notes"}`],
                      ),
                      h.span(
                        [],
                        [
                          `${r.actions} ${r.actions === 1 ? "action" : "actions"}`,
                        ],
                      ),
                    ],
                  ),
                  h.div(
                    [h.Class("admin-room-meta")],
                    [
                      h.span([], [`Created ${date(r.createdAt)}`]),
                      h.span([], [`Last activity ${date(r.updatedAt)}`]),
                    ],
                  ),
                  h.p([h.Class("admin-room-id")], [`Room ${r.id}`]),
                  m.selected === r.id
                    ? h.section(
                        [
                          h.Class("delete-confirm"),
                          h.AriaLabel("Confirm permanent deletion"),
                        ],
                        [
                          h.h3([], [`Permanently delete “${r.title}”?`]),
                          h.p(
                            [],
                            [
                              "This removes everyone’s notes, votes and actions. Anyone in the room will be disconnected. This cannot be undone.",
                            ],
                          ),
                          input(
                            `confirm-${r.id}`,
                            `Type the room name to confirm: ${r.title}`,
                            m.confirmation,
                            (value) => Message.Confirm({ value }),
                          ),
                          h.div(
                            [h.Class("admin-confirm-buttons")],
                            [
                              button(
                                "Cancel",
                                Message.Select({ id: "" }),
                                "secondary",
                                m.deleting,
                              ),
                              button(
                                m.deleting ? "Deleting…" : "Permanently delete",
                                Message.Delete(),
                                "danger",
                                m.deleting || m.confirmation !== r.title,
                              ),
                            ],
                          ),
                        ],
                      )
                    : null,
                ],
              ),
            ),
            !m.loading && !rooms.length
              ? h.div(
                  [h.Class("admin-empty")],
                  [
                    h.h2(
                      [],
                      [
                        m.search || m.filter
                          ? "No matching rooms"
                          : "A clean slate",
                      ],
                    ),
                    h.p(
                      [],
                      [
                        m.search || m.filter
                          ? "Try another search or filter."
                          : "Rooms will appear here when someone starts a retrospective.",
                      ],
                    ),
                  ],
                )
              : null,
          ],
        ),
      ],
    ),
  };
};

export function startAdmin() {
  Runtime.run(
    Runtime.makeApplication({
      Model,
      Flags: Schema.Struct({}),
      init: () => ({
        model: {
          transferBusy: false,
          preview: null,
          importPreview: false,
          rooms: [],
          pending: [],
          bulkTotal: 0,
          loading: true,
          deleting: false,
          search: "",
          filter: "",
          selected: "",
          confirmation: "",
          error: "",
          notice: "",
        },
        commands: [Load()],
      }),
      update,
      view,
      container: document.getElementById("root"),
      devTools: false,
    }),
    { flags: Effect.succeed({}) },
  );
}
