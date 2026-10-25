import { explainFailure as explain } from "./failure.ts";
import { Block } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { Effect, Layer, Schema, Cause, Match } from "effect";
import { BoardState, PrivateState } from "@retro/domain/Room/Values";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { availableVotes, phaseConfirmation } from "../roomProgress.ts";
import { controls } from "./controls.ts";

const Op = Schema.Literals([
  "ready",
  "reveal",
  "startVote",
  "vote",
  "votingDone",
  "finishVote",
  "close",
]);

const Model = Schema.Struct({
  busy: Schema.Boolean,
  pendingVote: Schema.String,
  confirm: Schema.String,
  phase: Schema.String,
});

const Message = defineMessageUnion({
  Run: { op: Op, id: Schema.String, selected: Schema.Boolean },
  Confirm: { op: Schema.String },
  Succeeded: { op: Op },
  VoteSaved: { state: Schema.NullOr(PrivateState) },
  Failed: { reason: Schema.String },
  Notify: { text: Schema.String },
  ToggleActions: {},
  InformedOfRoom: {},
});

const OutMessage = defineMessageUnion({
  Completed: {},
  Failed: { reason: Schema.String },
  Voted: { state: Schema.NullOr(PrivateState) },
  ToggleActions: {},
});

const SessionControlsDefinition = Block.makeDefinition("SessionControls", {
  Model,
  Message,
  OutMessage,
});

const SessionControlsComposition = SessionControlsDefinition.makeComposition();

export interface SessionControlsContext {
  readonly roomId: string;
  readonly actorId: string;
  readonly board: BoardState | null;
  readonly private: PrivateState;
  readonly busy: boolean;
  readonly unsavedNotes: boolean;
  readonly editingAction: boolean;
  readonly actionsOnly: boolean;
}

export const Mutate = SessionControlsDefinition.makeCommand("Mutate", {
  args: {
    roomId: Schema.String,
    op: Op,
    actorId: Schema.String,
    id: Schema.String,
    selected: Schema.Boolean,
  },
  messages: [Message.Succeeded, Message.VoteSaved, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return (a) =>
      Effect.gen(function* () {
        const base = {
          target: RoomId.make(a.roomId),
          commandId: crypto.randomUUID(),
        };

        switch (a.op) {
          case "ready":
            yield* api.SetReady({ ...base, ready: a.selected });
            break;
          case "reveal":
            yield* api.RevealNotes(base);
            break;
          case "startVote":
            yield* api.StartVoting(base);
            break;
          case "votingDone":
            yield* api.SetVotingDone({ ...base, done: a.selected });
            break;
          case "vote": {
            const receipt = yield* api.SetVote({
              ...base,
              noteId: a.id,
              selected: a.selected,
            });

            const state = yield* api.MyNotes.get(
              RoomId.make(`${a.roomId}:${a.actorId}`),
              { atLeast: receipt },
            );

            return Message.VoteSaved({ state });
          }

          case "finishVote":
            yield* api.FinishVoting(base);
            break;
          case "close":
            yield* api.CloseRoom(base);
            break;
        }

        return Message.Succeeded({ op: a.op });
      }).pipe(
        Effect.timeout("15 seconds"),
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

export const FocusControl = SessionControlsDefinition.makeCommand(
  "FocusControl",
  {
    args: { selector: Schema.String },
    messages: [Message.Notify],
    handler: function* () {
      return ({ selector }) =>
        Effect.promise(
          () =>
            new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
              requestAnimationFrame(() => {
                Array.from(document.querySelectorAll<HTMLElement>(selector))
                  .find((element) => element.getClientRects().length)
                  ?.focus();
                resolve(Message.Notify({ text: "" }));
              }),
            ),
        );
    },
  },
);

const init = SessionControlsComposition.makeInit(() => ({
  model: { busy: false, pendingVote: "", confirm: "", phase: "" },
}));

const update = SessionControlsComposition.makeUpdate(
  (m, msg, c: SessionControlsContext) =>
    Message.match(msg, {
      Confirm: ({ op }) =>
        !c.board || c.board.adminId !== c.actorId || c.editingAction
          ? { model: m }
          : {
              model: { ...m, confirm: op },
              commands: [
                FocusControl({
                  selector: op
                    ? ".confirm-bar button"
                    : ".session-footer .primary",
                }),
              ],
            },
      Run: (a) => {
        if (m.busy || c.busy || !c.board) return { model: m };
        const phase = c.board.phase;
        const admin = c.board.adminId === c.actorId;

        const allowed = Match.value(a.op).pipe(
          Match.when("ready", () => phase === "write" && !c.unsavedNotes),
          Match.when("vote", () => phase === "vote"),
          Match.when("votingDone", () => phase === "vote"),
          Match.when("reveal", () => admin && phase === "write"),
          Match.when("startVote", () => admin && phase === "reveal"),
          Match.when("finishVote", () => admin && phase === "vote"),
          Match.when(
            "close",
            () => admin && phase === "actions" && !c.editingAction,
          ),
          Match.exhaustive,
        );

        return !allowed
          ? { model: m }
          : {
              model: {
                ...m,
                busy: true,
                pendingVote: a.op === "vote" ? a.id : "",
                confirm: "",
              },
              commands: [
                Mutate({ roomId: c.roomId, actorId: c.actorId, ...a }),
              ],
            };
      },
      Succeeded: () => ({
        model: { ...m, busy: false },
        outMessage: OutMessage.Completed(),
      }),
      VoteSaved: ({ state }) => ({
        model: { ...m, busy: false, pendingVote: "" },
        outMessage: OutMessage.Voted({ state }),
      }),
      Failed: ({ reason }) => ({
        model: { ...m, busy: false, pendingVote: "" },
        outMessage: OutMessage.Failed({ reason }),
      }),
      Notify: () => ({ model: m }),
      ToggleActions: () => ({
        model: m,
        outMessage: OutMessage.ToggleActions(),
      }),
      InformedOfRoom: () => ({
        model: {
          ...m,
          phase: c.board?.phase ?? "",
          confirm:
            c.board?.phase !== m.phase || c.board?.adminId !== c.actorId
              ? ""
              : m.confirm,
        },
      }),
    }),
);

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");

const view = SessionControlsComposition.makeView.withInputs<
  SessionControlsContext & {
    readonly mode: "footer" | "confirm" | "vote";
    readonly note?: { id: string; text: string };
  }
>((m, inputs, h) => {
  const b = inputs.board;

  if (!b) return null;
  const writing = b.phase === "write";
  const admin = b.adminId === inputs.actorId;
  const me = b.participants.find((p) => p.id === inputs.actorId);
  const ready = b.participants.filter((p) => p.ready).length;
  const { button, icon } = controls(h, m.busy || inputs.busy);

  const run = (op: typeof Op.Type, id = "", selected = false) =>
    Message.Run({ op, id, selected });

  const avatar = (p: BoardState["participants"][number], i: number) =>
    h.span(
      [
        h.Class(`avatar color-${i % 6}`),
        h.Title(p.name + (p.id === inputs.actorId ? " (you)" : "")),
      ],
      [initials(p.name)],
    );

  const primary = Match.value(b.phase).pipe(
    Match.when("write", () => ({
      op: "reveal" as const,
      label: "Reveal notes",
      icon: "eye",
    })),
    Match.when("reveal", () => ({
      op: "startVote" as const,
      label: "Start voting",
      icon: "hand-pointing",
    })),
    Match.when("vote", () => ({
      op: "finishVote" as const,
      label: "Finish voting",
      icon: "chart-bar",
    })),
    Match.when("actions", () => ({
      op: "close" as const,
      label: "Close retrospective",
      icon: "check-circle",
    })),
    Match.orElse(() => null),
  );

  if (inputs.mode === "vote") {
    const n = inputs.note;

    return n && b.phase === "vote"
      ? h.button(
          [
            h.Class(
              `button vote ${inputs.private.votes.includes(n.id) ? "selected-vote" : ""}`,
            ),
            h.AriaPressed(String(inputs.private.votes.includes(n.id))),
            h.AriaLabel(
              `${inputs.private.votes.includes(n.id) ? "Remove vote from" : "Vote for"}: ${n.text}`,
            ),
            h.Disabled(
              !inputs.private.votes.includes(n.id) &&
                inputs.private.votes.length >= availableVotes(b),
            ),
            h.AriaBusy(m.pendingVote === n.id),
            h.OnClick(run("vote", n.id, !inputs.private.votes.includes(n.id))),
          ],
          [
            icon(inputs.private.votes.includes(n.id) ? "check" : "plus"),
            m.pendingVote === n.id
              ? "Saving…"
              : inputs.private.votes.includes(n.id)
                ? "Voted"
                : "Vote",
          ],
        )
      : null;
  }

  if (inputs.mode === "confirm")
    return m.confirm && primary && !inputs.editingAction
      ? h.div(
          [
            h.Class("confirm-bar"),
            h.Role("region"),
            h.AriaLabel("Confirm next phase"),
          ],
          [
            h.div(
              [],
              [
                h.strong([], [primary.label + "?"]),
                h.p([], [phaseConfirmation(b, m.confirm)]),
              ],
            ),
            button("Not yet", Message.Confirm({ op: "" }), "secondary"),
            button(primary.label, run(primary.op), "primary"),
          ],
        )
      : null;

  return h.footer(
    [h.Class("session-footer")],
    [
      h.div(
        [h.Class("footer-summary")],
        [
          b.phase === "actions"
            ? button(
                `${b.actions.length} action ${b.actions.length === 1 ? "item" : "items"}${inputs.actionsOnly ? " · filtered" : ""}`,
                Message.ToggleActions(),
                "quiet action-count",
                inputs.editingAction || !b.actions.length,
                "funnel",
              )
            : h.strong(
                [],
                [
                  writing
                    ? `${ready} of ${b.participants.length} ready`
                    : b.phase === "vote"
                      ? `${inputs.private.votes.length} of ${availableVotes(b)} votes used`
                      : b.phase === "closed"
                        ? b.archived
                          ? "Archived · read-only"
                          : "Session complete"
                        : "All notes revealed",
                ],
              ),
        ],
      ),
      writing
        ? h.div(
            [h.Class("ready-people")],
            b.participants
              .slice(0, 6)
              .map((p, i) =>
                h.div(
                  [h.Class("ready-person")],
                  [
                    avatar(p, i),
                    h.span(
                      [h.Class(p.ready ? "ready-label" : "subtle")],
                      [p.ready ? "Ready" : "Writing"],
                    ),
                  ],
                ),
              ),
          )
        : h.div([h.Class("footer-spacer")]),
      h.div(
        [h.Class("footer-actions")],
        [
          writing
            ? button(
                me?.ready ? "Keep writing" : "Done writing",
                run("ready", "", !me?.ready),
                "secondary",
                inputs.unsavedNotes,
                "check",
              )
            : null,
          b.phase === "vote"
            ? button(
                b.voters.includes(inputs.actorId)
                  ? "Change votes"
                  : "Done voting",
                run("votingDone", "", !b.voters.includes(inputs.actorId)),
                "secondary",
                m.busy,
                "check",
              )
            : null,
          admin && primary
            ? button(
                primary.label,
                Message.Confirm({ op: primary.op }),
                "primary",
                m.busy || inputs.editingAction,
                primary.icon,
              )
            : null,
        ],
      ),
    ],
  );
});

const prepare = () =>
  SessionControlsComposition.prepareBlock({
    init,
    update,
    view,
    EffectsLayer: Layer.mergeAll(Mutate.layer, FocusControl.layer),
    operations: { informRoom: Message.InformedOfRoom },
  });

export const SessionControlsBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare);
