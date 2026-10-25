import * as Redacted from "effect/Redacted";
import { inviteToken } from "../inviteToken.ts";
import * as Cause from "effect/Cause";
import { flow } from "effect/Function";
import * as Option from "effect/Option";
import { InvitationPreview, ErrorResponse } from "@retro/domain/HttpContracts";
import * as Match from "effect/Match";
import { Template, columnsFor } from "@retro/domain/Room/Templates";
import { sortByVotes } from "../voteSort.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { RoomId } from "@retro/domain/Room/Room.id";
import { BoardState, Column } from "@retro/domain/Room/Values";
import {
  ApplicationDefinition,
  Message,
  Op,
  ToolAction,
} from "./definition.ts";

const explain = flow(
  Schema.decodeUnknownOption(Schema.Struct({ reason: Schema.String })),
  Option.match({
    onSome: (e) => e.reason,
    onNone: () =>
      "Could not connect. Your draft is safe here. Please try again.",
  }),
);

export const Enter = ApplicationDefinition.makeCommand("Enter", {
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

export const LoadPreview = ApplicationDefinition.makeCommand("LoadPreview", {
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

export const Resume = ApplicationDefinition.makeCommand("Resume", {
  args: { roomId: Schema.String, invitation: Schema.Boolean },
  messages: [Message.Entered, Message.NeedsJoin, Message.RoomUnavailable],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return ({ roomId, invitation }) =>
      Effect.gen(function* () {
        const board = yield* api.SharedBoard.get(RoomId.make(roomId));

        return board && !invitation
          ? Message.Entered({ roomId, board })
          : Message.NeedsJoin();
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed(
            Cause.pretty(cause).includes("permanently deleted")
              ? Message.RoomUnavailable()
              : Message.NeedsJoin(),
          ),
        ),
      );
  },
});

export const Facilitate = ApplicationDefinition.makeCommand("Facilitate", {
  args: {
    roomId: Schema.String,
    action: ToolAction,
    seconds: Schema.Int,
    value: Schema.String,
  },
  messages: [Message.ToolDone, Message.Failed],
  handler: function* () {
    const api = yield* RetroApi.Client;

    return ({ roomId, action, seconds, value }) =>
      Effect.gen(function* () {
        const target = RoomId.make(roomId);

        const receipt = yield* Effect.gen(function* () {
          switch (action) {
            case "handover":
              return yield* api.Handover({ target, participantId: value });
            case "split":
              return yield* api.SplitNote({ target, noteId: value });
            case "undo":
              return yield* api.UndoCombine({ target });
            default:
              return yield* api.SetTimer({
                target,
                operation: action,
                seconds,
              });
          }
        });

        const board = yield* api.SharedBoard.get(target, { atLeast: receipt });

        return Message.ToolDone({
          board,
          notice: Match.value(action).pipe(
            Match.when("split", () => "Notes separated."),
            Match.when("handover", () => "Facilitation handed over."),
            Match.orElse(() => ""),
          ),
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

export const Combine = ApplicationDefinition.makeCommand("Combine", {
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

export const Mutate = ApplicationDefinition.makeCommand("Mutate", {
  args: {
    roomId: Schema.String,
    op: Op,
    actorId: Schema.String,
    id: Schema.String,
    column: Column,
    text: Schema.String,
    selected: Schema.Boolean,
    noteId: Schema.String,
    ownerId: Schema.String,
    dueDate: Schema.String,
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
          case "save":
            yield* api.SaveNote({
              ...base,
              id: a.id || crypto.randomUUID(),
              column: a.column,
              text: a.text,
            });
            break;
          case "delete":
            yield* api.DeleteNote({ ...base, id: a.id });
            break;
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
          case "action":
            yield* api.SaveAction({
              ...base,
              id: a.id || crypto.randomUUID(),
              noteId: a.noteId,
              text: a.text,
              ownerId: a.ownerId,
              dueDate: a.dueDate,
            });
            break;
          case "deleteAction":
            yield* api.DeleteAction({ ...base, id: a.id });
            break;
          case "archive":
          case "restore":
            yield* api.ArchiveRoom({ ...base, archived: a.op === "archive" });
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

export const EnterRoomViewport = ApplicationDefinition.makeCommand(
  "EnterRoomViewport",
  {
    messages: [Message.Notify],
    handler: function* () {
      return () =>
        Effect.promise(
          () =>
            new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
              requestAnimationFrame(() => {
                window.scrollTo({ top: 0, behavior: "instant" });
                resolve(Message.Notify({ text: "" }));
              }),
            ),
        );
    },
  },
);

export const FocusMerge = ApplicationDefinition.makeCommand("FocusMerge", {
  messages: [Message.Notify],
  handler: function* () {
    return () =>
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
            requestAnimationFrame(() => {
              document.getElementById("combine-target")?.focus();
              resolve(Message.Notify({ text: "" }));
            }),
          ),
      );
  },
});

export const FocusControl = ApplicationDefinition.makeCommand("FocusControl", {
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
});

export const FocusAction = ApplicationDefinition.makeCommand("FocusAction", {
  messages: [Message.Notify],
  handler: function* () {
    return () =>
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof Message.Notify>>((resolve) =>
            requestAnimationFrame(() => {
              const input = document.getElementById("action");
              input
                ?.closest(".action-form")
                ?.scrollIntoView({ block: "center" });
              input?.focus({ preventScroll: true });
              resolve(Message.Notify({ text: "" }));
            }),
          ),
      );
  },
});

export const LoadInvitations = ApplicationDefinition.makeCommand(
  "LoadInvitations",
  {
    args: { roomId: Schema.String, name: Schema.String },
    messages: [Message.InvitesLoaded, Message.InvitesFailed],
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
            return Message.InvitesFailed({
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

          return Message.InvitesLoaded({ links });
        }).pipe(
          Effect.catchCause(() =>
            Effect.succeed(
              Message.InvitesFailed({
                reason: "Could not load invitations. Please retry.",
              }),
            ),
          ),
        );
    },
  },
);

export const Copy = ApplicationDefinition.makeCommand("Copy", {
  args: { url: Schema.String },
  messages: [Message.Notify],
  handler: function* () {
    return ({ url }) =>
      Effect.tryPromise(() => navigator.clipboard.writeText(url)).pipe(
        Effect.map(() =>
          Message.Notify({
            text: "Personal link copied. Share the password separately.",
          }),
        ),
        Effect.catch(() =>
          Effect.succeed(
            Message.Notify({ text: "Select and copy the link below." }),
          ),
        ),
      );
  },
});

export const DeleteRetro = ApplicationDefinition.makeCommand("DeleteRetro", {
  args: { roomId: Schema.String, title: Schema.String },
  messages: [Message.Failed],
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
            Schema.decodeUnknownSync(ErrorResponse)(
              await response.json(),
            ).error,
          );
        window.location.assign("/");

        return Message.Failed({ reason: "" });
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(Message.Failed({ reason: explain(error) })),
        ),
      );
  },
});

export const Export = ApplicationDefinition.makeCommand("Export", {
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
