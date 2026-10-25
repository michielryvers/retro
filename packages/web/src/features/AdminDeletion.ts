import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Schema, Effect } from "effect";
import { Button, Input } from "@foldkit/ui";
import {
  RoomSummaries as Rooms,
  DeleteResponse,
} from "@retro/domain/HttpContracts";

const Model = Schema.Struct({
  pending: Rooms,
  bulkTotal: Schema.Int,
  deleting: Schema.Boolean,
  selected: Schema.String,
  confirmation: Schema.String,
  error: Schema.String,
  notice: Schema.String,
});

const Message = defineMessageUnion({
  Select: { id: Schema.String },
  Confirm: { value: Schema.String },
  Delete: {},
  DeleteAll: {},
  Deleted: { id: Schema.String },
  Failed: { error: Schema.String },
});

type Message = typeof Message.Type;

const OutMessage = defineMessageUnion({
  Deleted: { id: Schema.String, refresh: Schema.Boolean },
});

const AdminDeletionDefinition = Block.makeDefinition("AdminDeletion", {
  Model,
  Message,
  OutMessage,
});

const AdminDeletionComposition = AdminDeletionDefinition.makeComposition();

export interface DeletionContext {
  readonly rooms: typeof Rooms.Type;
  readonly loading: boolean;
}

const Delete = AdminDeletionDefinition.makeCommand("Delete", {
  args: { id: Schema.String, title: Schema.String },
  messages: [Message.Deleted, Message.Failed],
  handler: function* () {
    return ({ id, title }) =>
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
      );
  },
});

const init = AdminDeletionComposition.makeInit(() => ({
  model: {
    pending: [],
    bulkTotal: 0,
    deleting: false,
    selected: "",
    confirmation: "",
    error: "",
    notice: "",
  },
}));

const update = AdminDeletionComposition.makeUpdate(
  (m, msg, c: DeletionContext) =>
    Message.match(msg, {
      Select: (msg) => {
        if (m.deleting || c.loading) return { model: m };

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
      Confirm: (msg) => {
        return { model: { ...m, confirmation: msg.value } };
      },
      Delete: () => {
        const room = c.rooms.find((r) => r.id === m.selected);

        if (!room || m.deleting || m.confirmation !== room.title)
          return { model: m };

        return {
          model: { ...m, deleting: true, error: "" },
          commands: [Delete({ id: room.id, title: room.title })],
        };
      },
      DeleteAll: () => {
        const room = c.rooms[0];

        if (
          !room ||
          c.loading ||
          m.deleting ||
          m.selected !== "__all__" ||
          m.confirmation !== "DELETE ALL"
        )
          return { model: m };

        return {
          model: {
            ...m,
            deleting: true,
            pending: c.rooms,
            bulkTotal: c.rooms.length,
            error: "",
            notice: "",
          },
          commands: [Delete({ id: room.id, title: room.title })],
        };
      },
      Deleted: (msg) => {
        if (m.selected === "__all__") {
          const pending = m.pending.filter((room) => room.id !== msg.id);
          const next = pending[0];

          return {
            model: {
              ...m,
              pending,
              deleting: Boolean(next),
              selected: next ? "__all__" : "",
              confirmation: next ? m.confirmation : "",
              notice: next
                ? `Deleted ${m.bulkTotal - pending.length} of ${m.bulkTotal} rooms.`
                : `Permanently deleted ${m.bulkTotal} ${m.bulkTotal === 1 ? "room" : "rooms"}.`,
            },
            outMessage: OutMessage.Deleted({ id: msg.id, refresh: !next }),
            commands: next ? [Delete({ id: next.id, title: next.title })] : [],
          };
        }

        return {
          outMessage: OutMessage.Deleted({ id: msg.id, refresh: false }),
          model: {
            ...m,
            deleting: false,
            selected: "",
            confirmation: "",
            notice:
              "Room permanently deleted. Its invite link no longer works.",
          },
        };
      },
      Failed: ({ error }) => ({ model: { ...m, deleting: false, error } }),
    }),
);

const view = AdminDeletionComposition.makeView.withInputs<
  DeletionContext & {
    readonly mode: "bulkButton" | "bulk" | "button" | "confirm" | "feedback";
    readonly id?: string;
  }
>((m, inputs, h) => {
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

  if (inputs.mode === "bulkButton")
    return button(
      "Delete all rooms",
      Message.Select({ id: "__all__" }),
      "danger-outline",
      inputs.loading || m.deleting || !inputs.rooms.length,
    );

  if (inputs.mode === "button")
    return button(
      "Delete room",
      Message.Select({ id: inputs.id ?? "" }),
      "danger-outline",
      m.deleting || inputs.loading,
    );

  if (inputs.mode === "feedback")
    return h.div(
      [],
      [
        m.error ? h.p([h.Class("error"), h.Role("alert")], [m.error]) : null,
        m.notice
          ? h.p([h.Class("notice"), h.Role("status")], [m.notice])
          : null,
      ],
    );

  if (inputs.mode === "bulk")
    return m.selected === "__all__"
      ? h.section(
          [
            h.Class("delete-confirm"),
            h.AriaLabel("Confirm deletion of all rooms"),
          ],
          [
            h.h2(
              [],
              [
                `Permanently delete all ${m.deleting ? m.bulkTotal : inputs.rooms.length} rooms?`,
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
                  m.deleting ? "Deleting…" : "Permanently delete all rooms",
                  Message.DeleteAll(),
                  "danger",
                  m.deleting ||
                    inputs.loading ||
                    m.confirmation !== "DELETE ALL" ||
                    !inputs.rooms.length,
                ),
              ],
            ),
          ],
        )
      : null;
  const r = inputs.rooms.find((r) => r.id === inputs.id);

  if (!r) return null;

  return m.selected === r.id
    ? h.section(
        [h.Class("delete-confirm"), h.AriaLabel("Confirm permanent deletion")],
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
    : null;
});

const prepare = () =>
  AdminDeletionComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Delete.layer,
  });

export const AdminDeletionBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
