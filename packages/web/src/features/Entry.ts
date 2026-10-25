import { PasswordInputBlock } from "./PasswordInput.ts";
import { TemplatePickerBlock } from "./TemplatePicker.ts";
import { Update } from "foldkit";
import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema, Redacted, Cause, Option, Match } from "effect";
import { flow } from "effect/Function";
import { Button, Input } from "@foldkit/ui";
import { Template } from "@retro/domain/Room/Templates";
import { InvitationPreview } from "@retro/domain/HttpContracts";
import { BoardState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { inviteToken } from "../inviteToken.ts";
import { InviteLink } from "./Invitations.ts";

export const Flags = Schema.Struct({
  participantId: Schema.String,
  inviteToken: Schema.String,
  actorId: Schema.String,
  roomId: Schema.String,
  name: Schema.String,
});

const Field = Schema.Literals(["name", "title"]);

const Model = Schema.Struct({
  roomId: Schema.String,
  participantId: Schema.String,
  inviteToken: Schema.String,
  name: Schema.String,
  title: Schema.String,
  password: PasswordInputBlock.Model,
  templatePicker: TemplatePickerBlock.Model,
  invitationPreview: Schema.NullOr(InvitationPreview),
  busy: Schema.Boolean,
  error: Schema.String,
});

const Message = defineMessageUnion({
  Field: { field: Field, value: Schema.String },
  Enter: {},
  PreviewLoaded: { preview: Schema.NullOr(InvitationPreview) },
  Entered: {
    roomId: Schema.String,
    board: BoardState,
    links: Schema.optionalKey(Schema.Array(InviteLink)),
  },
  Failed: { reason: Schema.String },
  RoomUnavailable: {},
});

const OutMessage = defineMessageUnion({
  Entered: {
    roomId: Schema.String,
    board: BoardState,
    links: Schema.optionalKey(Schema.Array(InviteLink)),
  },
  Unavailable: {},
});

const EntryDefinition = Block.makeDefinition("Entry", {
  Model,
  Message,
  OutMessage,
});

const PasswordBinding = EntryDefinition.makeBinding(PasswordInputBlock, {
  field: "password",
  delivery: { toUpdateContext: (m) => [m.busy] },
});

const TemplateBinding = EntryDefinition.makeBinding(TemplatePickerBlock, {
  field: "templatePicker",
  delivery: { toUpdateContext: (m) => [m.busy] },
});

const EntryComposition = EntryDefinition.makeComposition({
  bindings: [PasswordBinding, TemplateBinding],
});

const explain = flow(
  Schema.decodeUnknownOption(Schema.Struct({ reason: Schema.String })),
  Option.match({
    onSome: (e) => e.reason,
    onNone: () =>
      "Could not connect. Your draft is safe here. Please try again.",
  }),
);

export const Enter = EntryDefinition.makeCommand("Enter", {
  args: {
    roomId: Schema.String,
    title: Schema.String,
    name: Schema.String,
    template: Template,
    password: Schema.String,
    participantId: Schema.String,
    token: Schema.String,
  },
  messages: [Message.Entered, Message.Failed, Message.RoomUnavailable],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return ({
      roomId,
      title,
      name,
      template,
      password,
      participantId,
      token,
    }) =>
      Effect.gen(function* () {
        const target = RoomId.make(roomId || crypto.randomUUID());

        const receipt = roomId
          ? yield* api.JoinRoom({
              target,
              participantId,
              token: Redacted.make(token),
              password: Redacted.make(password),
            })
          : yield* api.CreateRoom({
              target,
              title,
              name,
              template,
              password: Redacted.make(password),
            });

        if (
          roomId &&
          receipt.reply &&
          "joined" in receipt.reply &&
          !receipt.reply.joined
        )
          return Message.Failed({
            reason: "The invitation or password is incorrect.",
          });
        const board = yield* api.SharedBoard.get(target, { atLeast: receipt });

        if (!board)
          return Message.Failed({
            reason: "The room is still opening. Try again in a moment.",
          });
        yield* Effect.sync(() => {
          try {
            if (name) localStorage.setItem("cg_name", name);
            sessionStorage.removeItem(`cg_invite_${target}`);
          } catch {}

          history.replaceState(null, "", `/room/${target}`);
        });

        const invitations = !roomId
          ? yield* api.Invitations.get(target, { atLeast: receipt }).pipe(
              Effect.timeout("8 seconds"),
              Effect.catchCause(() => Effect.succeed(null)),
            )
          : null;

        const links = invitations
          ? yield* Effect.promise(() =>
              Promise.all(
                invitations.people.map(async (p) => ({
                  ...p,
                  url: `${location.origin}/room/${target}#invite=${p.id}.${await inviteToken(Redacted.value(invitations.seed), p.id)}`,
                })),
              ),
            )
          : undefined;

        return links
          ? Message.Entered({ roomId: target, board, links })
          : Message.Entered({ roomId: target, board });
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed(
            Cause.pretty(cause).includes("permanently deleted")
              ? Message.RoomUnavailable()
              : Message.Failed({
                  reason: explain(Cause.squash(cause)).includes(
                    "already signed in as someone else",
                  )
                    ? "This browser is already signed in as someone else in this room. Open this invite in a private window or another browser profile."
                    : explain(Cause.squash(cause)).includes("Too many attempts")
                      ? "Too many attempts. Try again in 15 minutes."
                      : roomId
                        ? "Could not join. Check your personal link and room password, then try again."
                        : "Could not create the room. Please try again.",
                }),
          ),
        ),
      );
  },
});

export const LoadPreview = EntryDefinition.makeCommand("LoadPreview", {
  args: {
    roomId: Schema.String,
    participantId: Schema.String,
    token: Schema.String,
  },
  messages: [Message.PreviewLoaded],
  handler: function* () {
    return (input) =>
      Effect.tryPromise(async () => {
        const response = await fetch("/api/invitation-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });

        return Message.PreviewLoaded({
          preview: response.ok
            ? Schema.decodeUnknownSync(InvitationPreview)(await response.json())
            : null,
        });
      }).pipe(
        Effect.catch(() =>
          Effect.succeed(Message.PreviewLoaded({ preview: null })),
        ),
      );
  },
});

const init = EntryComposition.makeInit((flags: typeof Flags.Type) => ({
  model: {
    roomId: flags.roomId,
    participantId: flags.participantId,
    inviteToken: flags.inviteToken,
    name: flags.name,
    title: "",
    invitationPreview: null,
    busy: false,
    error: "",
  },
  commands:
    flags.inviteToken && flags.participantId
      ? [
          LoadPreview({
            roomId: flags.roomId,
            participantId: flags.participantId,
            token: flags.inviteToken,
          }),
        ]
      : [],
}));

const update = EntryComposition.makeUpdate((m, msg) =>
  Message.match(msg, {
    Field: ({ field, value }) => ({
      model: m.busy ? m : { ...m, [field]: value },
    }),
    Enter: () =>
      m.busy
        ? { model: m }
        : {
            model: { ...m, busy: true, error: "" },
            commands: [
              Enter({
                roomId: m.roomId,
                title: m.title,
                name: m.name,
                template: m.templatePicker.selected,
                password: m.password.value,
                participantId: m.participantId,
                token: m.inviteToken,
              }),
            ],
          },
    PreviewLoaded: ({ preview }) => ({
      model: { ...m, invitationPreview: preview },
    }),
    Entered: ({ roomId, board, links }) =>
      Update.withOutMessage(
        Update.combineSteps([
          EntryDefinition.makeFieldsStep(() => ({
            busy: () => false,
            inviteToken: () => "",
          })),
          PasswordBinding.clear(false),
        ])(m),
        links
          ? OutMessage.Entered({ roomId, board, links })
          : OutMessage.Entered({ roomId, board }),
      ),
    Failed: ({ reason }) => ({ model: { ...m, busy: false, error: reason } }),
    RoomUnavailable: () => ({
      model: { ...m, busy: false },
      outMessage: OutMessage.Unavailable(),
    }),
  }),
);

type Message = typeof Message.Type;

const view = EntryComposition.makeView((m, h) => {
  const icon = (name: string) =>
    h.i([h.Class(`ph ph-${name}`), h.AriaHidden(true)]);

  const field = (
    id: typeof Field.Type,
    label: string,
    value: string,
    placeholder = "",
    type = "text",
  ) =>
    Input.view(
      {
        id,
        value,
        type,
        placeholder,
        onInput: (value) => Message.Field({ field: id, value }),
        toView: (a) =>
          h.div(
            [h.Class("field")],
            [
              h.label([...a.label], [label]),
              h.div(
                [h.Class("input-control")],
                [
                  h.input([
                    ...a.input,
                    h.Disabled(m.busy),
                    h.Maxlength(
                      Match.value(id).pipe(
                        Match.when("name", () => 40),
                        Match.when("title", () => 100),
                        Match.orElse(() => 500),
                      ),
                    ),
                  ]),
                  null,
                ],
              ),
            ],
          ),
      },
      h,
    );

  const feedback = () =>
    m.error
      ? h.div(
          [h.Class("error"), h.Role("alert")],
          [icon("warning-circle"), m.error],
        )
      : null;

  return h.div(
    [h.Class("welcome")],
    [
      h.main(
        [h.Class("welcome-main")],
        [
          h.form(
            [h.Class("entry-form"), h.OnSubmit(Message.Enter())],
            [
              h.a(
                [h.Class("entry-brand"), h.Href("/")],
                [
                  h.img([h.Src("/retro.svg"), h.Alt("")]),
                  h.span([], ["Retro"]),
                ],
              ),
              h.h2(
                [],
                [
                  m.roomId
                    ? m.invitationPreview
                      ? `Hi, ${m.invitationPreview.name}.`
                      : "Join the retrospective"
                    : "Create a retrospective",
                ],
              ),
              m.roomId && m.invitationPreview
                ? h.p(
                    [h.Class("invitation-welcome")],
                    [
                      "You’re invited to ",
                      h.strong([], [m.invitationPreview.title]),
                      ".",
                    ],
                  )
                : null,
              m.roomId && !m.inviteToken
                ? h.p(
                    [h.Class("subtle")],
                    ["Ask your facilitator for your personal invitation link."],
                  )
                : null,
              ...(!m.roomId
                ? [
                    field(
                      "title",
                      "Room name",
                      m.title,
                      "e.g. Sprint 24 retrospective",
                    ),
                  ]
                : []),
              !m.roomId
                ? h.block(
                    TemplateBinding.embedView({
                      slotId: "format",
                      model: m.templatePicker,
                      viewInputs: { busy: m.busy },
                    }),
                  )
                : null,
              !m.roomId
                ? field("name", "Your name", m.name, "e.g. Alex")
                : null,
              !m.roomId || m.inviteToken
                ? h.block(
                    PasswordBinding.embedView({
                      slotId: "password",
                      model: m.password,
                      viewInputs: { busy: m.busy, joining: Boolean(m.roomId) },
                    }),
                  )
                : null,
              feedback(),
              !m.roomId
                ? h.p(
                    [h.Class("muted")],
                    [
                      "Rooms close after 7 days and are deleted 7 days after closing.",
                    ],
                  )
                : null,

              !m.roomId || m.inviteToken
                ? Button.view(
                    {
                      type: "submit",
                      isDisabled:
                        m.busy ||
                        (!m.roomId &&
                          (!m.name.trim() ||
                            !m.title.trim() ||
                            m.password.value.length < 3)) ||
                        (Boolean(m.roomId) &&
                          (!m.inviteToken || !m.password.value)),
                      toView: (a) =>
                        h.button(
                          [
                            ...a.button,
                            h.Class(
                              `button primary wide ${m.busy ? "entry-loading" : ""}`,
                            ),
                          ],
                          [
                            m.busy
                              ? m.roomId
                                ? "Joining your room…"
                                : "Creating your room…"
                              : m.roomId
                                ? "Join room"
                                : "Create room",
                            m.busy
                              ? h.span(
                                  [
                                    h.Class("loading-notes"),
                                    h.AriaHidden(true),
                                  ],
                                  [h.span([]), h.span([]), h.span([])],
                                )
                              : icon("arrow-right"),
                          ],
                        ),
                    },
                    h,
                  )
                : null,
              h.div(
                [
                  h.Class("entry-progress"),
                  h.Role("status"),
                  h.AriaLive("polite"),
                ],
                [
                  m.busy
                    ? m.roomId
                      ? "Finding your seat…"
                      : "Putting the sticky notes out…"
                    : "",
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

const prepare = () =>
  EntryComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(Enter.layer, LoadPreview.layer),
  });

export const EntryBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
