import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import { update } from "./application/update.ts";
import { type Model, type Message } from "./application/definition.ts";

const CategoryValues = Schema.Record(Schema.String, Schema.String);

const StoredDrafts = Schema.Struct({
  drafts: CategoryValues,
  ids: CategoryValues,
});

const prefix = "cg_drafts_v2:";
const keyFor = (room: string, actor: string) => `${prefix}${room}:${actor}`;
const empty = () => ({});

// Keep storage outside the pure update function. Writing synchronously avoids
// losing the latest keystroke when a tab closes or an async command is cancelled.
export const updateWithDrafts = (model: Model, message: Message) => {
  const result = update(model, message);
  let next = result.model;

  try {
    if (next.unavailable) {
      localStorage.removeItem(keyFor(model.roomId, model.actorId));

      for (const key of Object.keys(localStorage))
        if (key.startsWith(`${prefix}${model.roomId}:`))
          localStorage.removeItem(key);

      return result;
    }

    if (!next.entered || !next.roomId || !next.actorId) return result;
    const key = keyFor(next.roomId, next.actorId);

    if (next.board?.phase === "closed") {
      localStorage.removeItem(key);

      return {
        ...result,
        model: { ...next, drafts: empty(), draftIds: empty(), draft: "" },
      };
    }

    if (!model.entered && next.board?.phase === "write") {
      const raw = localStorage.getItem(key);

      if (raw) {
        const saved = Schema.decodeUnknownSync(StoredDrafts)(JSON.parse(raw));
        next = {
          ...next,
          drafts: saved.drafts,
          draftIds: saved.ids,
          draft: saved.drafts[next.mobileColumn] ?? "",
        };
      }
    }

    if (next.drafts !== model.drafts || next.draftIds !== model.draftIds) {
      if (Object.values(next.drafts).some(Boolean))
        localStorage.setItem(
          key,
          JSON.stringify({ drafts: next.drafts, ids: next.draftIds }),
        );
      else localStorage.removeItem(key);
    }
  } catch {
    // Private browsing, quotas, and corrupt data must not prevent participation.
    if (Predicate.isTagged(message, "Field") && message.field === "draft")
      next = {
        ...next,
        notice: "Draft backup unavailable. Keep this tab open until you save.",
      };
  }

  return { ...result, model: next };
};
