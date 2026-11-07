import { expect, it } from "vitest";
import { init, Message, update } from "../src/App.ts";
import { SHARED_INVITATION } from "@retro/domain/Room/SharedInvitation";

const flags = { actorId: "session", roomId: "retro", participantId: SHARED_INVITATION, inviteToken: "a".repeat(64), name: "Alex" };

it("resumes existing membership for shared links and never loads a personal preview for everyone", () => {
  const shared = init(flags);

  expect(shared.commands).toHaveLength(1);
  expect(shared.commands?.[0]?.args).toEqual({ roomId: "retro", invitation: false });
  const personal = init({ ...flags, participantId: "person-id" });

  expect(personal.commands).toHaveLength(2);
  expect(personal.commands?.[0]?.args).toEqual({ roomId: "retro", invitation: true });
  expect(personal.commands?.[1]?.args).toEqual({ roomId: "retro", participantId: "person-id", token: flags.inviteToken });
});

it("passes self-entered names and shared credentials to entry without trusting the name as identity", () => {
  const model = init(flags).model;
  const named = update(model, Message.Field({ field: "name", value: "Another Alex" })).model;
  const entered = update({ ...named, busy: false, password: "abc" }, Message.Enter());

  expect(entered.commands?.[0]?.args).toMatchObject({ name: "Another Alex", participantId: SHARED_INVITATION, token: flags.inviteToken, password: "abc" });
  expect(entered.model.actorId).toBe(model.actorId);
  expect(entered.model.sessionId).toBe("session");
});
