import { AdminDeletionBlock } from "./features/AdminDeletion.ts";
import { AdminFiltersBlock } from "./features/AdminFilters.ts";
import { RoomSummaries as Rooms } from "@retro/domain/HttpContracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Block, Program, Runtime } from "foldkit";

import { defineMessageUnion } from "foldkit/message";
import type { Document } from "foldkit/html";
import { Button } from "@foldkit/ui";
import { templates } from "@retro/domain/Room/Templates";

const Model = Schema.Struct({
  deletion: AdminDeletionBlock.Model,
  filters: AdminFiltersBlock.Model,
  rooms: Rooms,
  loading: Schema.Boolean,
  error: Schema.String,
});

type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  Loaded: { rooms: Rooms },
  Failed: { error: Schema.String },
  Refresh: {},
});

type Message = typeof Message.Type;

export const AdminDefinition = Block.makeDefinition("Admin", {
  Model,
  Message,
});

const FiltersBinding = AdminDefinition.makeBinding(AdminFiltersBlock, {
  field: "filters",
});

const DeletionBinding = AdminDefinition.makeBinding(AdminDeletionBlock, {
  field: "deletion",
  delivery: {
    toUpdateContext: (m) => [{ rooms: m.rooms, loading: m.loading }],
  },
}).withOutMessagePolicy({
  fold: AdminDefinition.makeOutMessageFold(AdminDeletionBlock, {
    Deleted: ({ id, refresh }) =>
      AdminDefinition.makeStep((m) => ({
        model: { ...m, rooms: m.rooms.filter((r) => r.id !== id) },
        commands: refresh ? [Load()] : [],
      })),
  }),
});

export const AdminComposition = AdminDefinition.makeComposition({
  bindings: [FiltersBinding, DeletionBinding],
});

const Load = AdminDefinition.makeCommand("Load", {
  messages: [Message.Loaded, Message.Failed],
  handler: function* () {
    return () =>
      Effect.tryPromise(async () => {
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
      );
  },
});

export const update = AdminComposition.makeUpdate({
  Loaded: (m, msg) => {
    return { model: { ...m, rooms: msg.rooms, loading: false, error: "" } };
  },
  Failed: (m, msg) => {
    return {
      model: { ...m, loading: false, error: msg.error },
    };
  },
  Refresh: (m) => {
    if (m.deletion.deleting) return { model: m };

    return {
      model: { ...m, loading: true, error: "" },
      commands: [Load()],
    };
  },
});

const view = AdminComposition.makeView((m, h): Document => {
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

  const rooms = m.rooms.filter(
    (r) =>
      (!m.filters.filter ||
        (m.filters.filter === "active"
          ? !["closed", "deleting"].includes(r.phase)
          : r.phase === m.filters.filter)) &&
      `${r.title} ${r.id}`
        .toLowerCase()
        .includes(m.filters.search.toLowerCase()),
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
                h.block(
                  DeletionBinding.embedView({
                    slotId: "bulk-delete",
                    model: m.deletion,
                    viewInputs: {
                      rooms: m.rooms,
                      loading: m.loading,
                      mode: "bulkButton",
                    },
                  }),
                ),
                button(
                  m.loading ? "Refreshing…" : "Refresh",
                  Message.Refresh(),
                  "secondary",
                  m.loading || m.deletion.deleting,
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
            h.block(
              DeletionBinding.embedView({
                slotId: "bulk-delete-confirm",
                model: m.deletion,
                viewInputs: {
                  rooms: m.rooms,
                  loading: m.loading,
                  mode: "bulk",
                },
              }),
            ),
            h.block(
              FiltersBinding.embedView({
                slotId: "admin-filters",
                model: m.filters,
                viewInputs: { disabled: m.deletion.deleting },
              }),
            ),
            m.error
              ? h.p([h.Class("error"), h.Role("alert")], [m.error])
              : null,
            h.block(
              DeletionBinding.embedView({
                slotId: "deletion-feedback",
                model: m.deletion,
                viewInputs: {
                  rooms: m.rooms,
                  loading: m.loading,
                  mode: "feedback",
                },
              }),
            ),
            h.p(
              [h.Class("subtle"), h.Role("status")],
              [
                m.loading
                  ? "Loading rooms…"
                  : `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"} · Most recently active first`,
              ],
            ),
            ...rooms.map((r) =>
              h.keyed("article")(
                r.id,
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
                      h.block(
                        DeletionBinding.embedView({
                          slotId: `delete-${r.id}`,
                          model: m.deletion,
                          viewInputs: {
                            rooms: m.rooms,
                            loading: m.loading,
                            mode: "button",
                            id: r.id,
                          },
                        }),
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
                  h.block(
                    DeletionBinding.embedView({
                      slotId: `delete-confirm-${r.id}`,
                      model: m.deletion,
                      viewInputs: {
                        rooms: m.rooms,
                        loading: m.loading,
                        mode: "confirm",
                        id: r.id,
                      },
                    }),
                  ),
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
                        m.filters.search || m.filters.filter
                          ? "No matching rooms"
                          : "A clean slate",
                      ],
                    ),
                    h.p(
                      [],
                      [
                        m.filters.search || m.filters.filter
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
});

const init = AdminComposition.makeInit(() => ({
  model: {
    rooms: [],
    pending: [],
    bulkTotal: 0,
    loading: true,
    deleting: false,
    selected: "",
    confirmation: "",
    error: "",
    notice: "",
  },
  commands: [Load()],
}));

const prepare = () =>
  AdminComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Load.layer,
  });

export const AdminBlock: Block.FromAssemblyWithView<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);

export function startAdmin() {
  Runtime.run(
    Program.make({
      block: AdminBlock,
      container: document.getElementById("root"),
      devTools: false,
    }),
  );
}
