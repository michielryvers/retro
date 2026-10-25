import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema, Redacted } from "effect";
import { Input } from "@foldkit/ui";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { BoardState } from "@retro/domain/Room/Values";
import { inviteToken } from "../inviteToken.ts";
import { controls } from "./controls.ts";

export const InviteLink = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
});

const Model = Schema.Struct({
  name: Schema.String,
  links: Schema.Array(InviteLink),
  loading: Schema.Boolean,
  busy: Schema.Boolean,
  error: Schema.String,
});

const Message = defineMessageUnion({
  ChangedName: { value: Schema.String },
  Load: {},
  Add: {},
  Loaded: { links: Schema.Array(InviteLink) },
  Failed: { reason: Schema.String },
  Copy: { url: Schema.String },
  Copied: { text: Schema.String },
  Close: {},
  InformedOfLinks: { links: Schema.Array(InviteLink), error: Schema.String },
});

const OutMessage = defineMessageUnion({
  Closed: {},
  Notified: { text: Schema.String },
});

const InvitationsDefinition = Block.makeDefinition("Invitations", {
  Model,
  Message,
  OutMessage,
});

const InvitationsComposition = InvitationsDefinition.makeComposition();

export interface InvitationContext {
  readonly roomId: string;
  readonly allowed: boolean;
  readonly closed: boolean;
}

export const LoadInvitations = InvitationsDefinition.makeCommand(
  "LoadInvitations",
  {
    args: { roomId: Schema.String, name: Schema.String },
    messages: [Message.Loaded, Message.Failed],
    handler: function* () {
      const api = yield* RetroApi.Client;

      return ({ roomId, name }) =>
        Effect.gen(function* () {
          const target = RoomId.make(roomId);

          const receipt = name
            ? yield* api.InviteParticipant({ target, name })
            : undefined;

          const invitations = yield* api.Invitations.get(
            target,
            receipt ? { atLeast: receipt } : undefined,
          ).pipe(Effect.timeout("8 seconds"));

          if (!invitations)
            return Message.Failed({
              reason: "Could not load invitations.",
            });

          const links = yield* Effect.promise(() =>
            Promise.all(
              invitations.people.map(async (p) => ({
                ...p,
                url: `${location.origin}/room/${roomId}#invite=${p.id}.${await inviteToken(Redacted.value(invitations.seed), p.id)}`,
              })),
            ),
          );

          return Message.Loaded({ links });
        }).pipe(
          Effect.catchCause(() =>
            Effect.succeed(
              Message.Failed({
                reason: "Could not load invitations. Please retry.",
              }),
            ),
          ),
        );
    },
  },
);

export const Copy = InvitationsDefinition.makeCommand("Copy", {
  args: { url: Schema.String },
  messages: [Message.Copied],
  handler: function* () {
    return ({ url }) =>
      Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
        Effect.map(() =>
          Message.Copied({
            text: "Personal link copied. Share the password separately.",
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.Copied({ text: "Select and copy the link below." }),
          ),
        ),
      );
  },
});

const init = InvitationsComposition.makeInit(() => ({
  model: { name: "", links: [], loading: false, busy: false, error: "" },
}));

const update = InvitationsComposition.makeUpdate(
  (m, msg, context: InvitationContext) =>
    Message.match(msg, {
      ChangedName: ({ value }) => ({
        model: m.busy ? m : { ...m, name: value },
      }),
      Load: () =>
        context.allowed
          ? {
              model: { ...m, loading: true, error: "" },
              commands: [LoadInvitations({ roomId: context.roomId, name: "" })],
            }
          : { model: m },
      Add: () =>
        !context.allowed || context.closed || m.busy || !m.name.trim()
          ? { model: m }
          : {
              model: { ...m, busy: true, error: "" },
              commands: [
                LoadInvitations({
                  roomId: context.roomId,
                  name: m.name.trim(),
                }),
              ],
            },
      Loaded: ({ links }) => ({
        model: {
          ...m,
          links,
          name: "",
          loading: false,
          busy: false,
          error: "",
        },
      }),
      Failed: ({ reason }) => ({
        model: { ...m, loading: false, busy: false, error: reason },
      }),
      Copy: ({ url }) => ({ model: m, commands: [Copy({ url })] }),
      Copied: ({ text }) => ({
        model: m,
        outMessage: OutMessage.Notified({ text }),
      }),
      Close: () => ({ model: m, outMessage: OutMessage.Closed() }),
      InformedOfLinks: ({ links, error }) => ({
        model: { ...m, links, error, loading: false, busy: false },
      }),
    }),
);

const view = InvitationsComposition.makeView.withInputs<{
  readonly board: BoardState;
  readonly actorId: string;
}>((m, inputs, h) => {
  const { button, field, icon } = controls(h, m.busy);

  return h.section(
    [h.Class("invitations-panel"), h.AriaLabel("People and invitations")],
    [
      h.div(
        [h.Class("invitation-heading")],
        [
          h.h2([], ["People & invites"]),
          button("Close", Message.Close(), "quiet", false, "x"),
        ],
      ),
      m.loading ? h.p([h.Role("status")], ["Loading invitations…"]) : null,
      m.error
        ? h.div(
            [h.Role("alert")],
            [m.error, button("Retry invitations", Message.Load(), "secondary")],
          )
        : null,
      h.p(
        [h.Class("subtle")],
        [
          "Each person gets their own link. Share the room password separately.",
        ],
      ),
      h.form(
        [h.Class("invitation-form"), h.OnSubmit(Message.Add())],
        [
          field(
            "inviteName",
            "Participant name",
            m.name,
            (value) => Message.ChangedName({ value }),
            "e.g. Sam",
          ),
          button(
            "Add participant",
            Message.Add(),
            "primary",
            !m.name.trim() || m.busy || inputs.board.phase === "closed",
            "user-plus",
          ),
        ],
      ),
      ...m.links.map((p) =>
        h.div(
          [h.Class("invitation-row"), h.Key(p.id)],
          [
            h.div(
              [],
              [
                h.strong(
                  [],
                  [p.name + (p.id === inputs.actorId ? " (you)" : "")],
                ),
                h.span(
                  [h.Class("subtle")],
                  [
                    inputs.board.participants.some(
                      (person) => person.id === p.id,
                    )
                      ? "Joined"
                      : "Invited",
                  ],
                ),
              ],
            ),
            Input.view(
              {
                id: `invite-${p.id}`,
                value: p.url,
                isReadOnly: true,
                toView: (a) =>
                  h.input([
                    ...a.input,
                    h.AriaLabel(`Personal link for ${p.name}`),
                  ]),
              },
              h,
            ),
            h.button(
              [
                h.Type("button"),
                h.Class("button secondary invite-copy"),
                h.AriaLabel(`Copy link for ${p.name}`),
                h.OnClick(Message.Copy({ url: p.url })),
              ],
              [icon("copy"), h.span([], ["Copy link"])],
            ),
          ],
        ),
      ),
    ],
  );
});

const prepare = () =>
  InvitationsComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(LoadInvitations.layer, Copy.layer),
    operations: {
      requestLoad: Message.Load,
      informLinks: Message.InformedOfLinks,
    },
  });

export const InvitationsBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
