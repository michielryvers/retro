import { RoomSummaries as Rooms, DeleteResponse } from "@retro/domain/HttpContracts";
import * as Match from "effect/Match";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Command, Runtime, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import type { HtmlBuilder, Document } from "foldkit/html";
import { Button, Input } from "@foldkit/ui";
import { templates } from "@retro/domain/Room/Templates";

const Model = Schema.Struct({
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

export const update = (
  m: Model,
  msg: Message,
): Update.Return<Model, Message> => {
  return Match.value(msg).pipe(
    Match.tagsExhaustive({
      Loaded: (msg): Update.Return<Model, Message> => {
        return { model: { ...m, rooms: msg.rooms, loading: false, error: "" } };
      },
      Failed: (msg): Update.Return<Model, Message> => {
        return {
          model: { ...m, loading: false, deleting: false, error: msg.error },
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
        isDisabled: disabled,
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
                            [phases.get(r.phase) ?? r.phase],
                          ),
                          h.h2([], [r.title]),
                          h.p(
                            [h.Class("subtle")],
                            [templates[r.template].title],
                          ),
                        ],
                      ),
                      button(
                        "Delete room",
                        Message.Select({ id: r.id }),
                        "danger-outline",
                        m.deleting,
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
