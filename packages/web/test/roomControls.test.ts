import { expect, it } from "vitest";
import { init } from "../src/application/init.ts";
import { Message } from "../src/application/definition.ts";
import { update } from "../src/application/update.ts";
import { emptyBoard } from "@retro/domain/Room/Values";

const base = () => ({
  ...init({
    actorId: "host",
    roomId: "room",
    participantId: "",
    inviteToken: "",
    name: "Host",
  }).model,
  board: { ...emptyBoard, adminId: "host" },
});

it("switches sections without stacking people and facilitator controls", () => {
  const people = update(base(), Message.MobileMenu()).model;
  expect(people).toMatchObject({
    invite: true,
    toolsOpen: false,
    roomSection: "people",
  });
  const timer = update(people, Message.RoomSection({ section: "timer" })).model;
  expect(timer).toMatchObject({
    invite: false,
    toolsOpen: true,
    roomSection: "timer",
  });
  const reopened = update(timer, Message.Invite()).model;
  expect(reopened).toMatchObject({
    invite: true,
    toolsOpen: false,
    roomSection: "people",
  });
  expect(update(reopened, Message.CloseRoom()).model).toMatchObject({
    invite: false,
    toolsOpen: false,
    mobileMenu: false,
  });
});

it("does not load private invitations for participants", () => {
  const opened = update({ ...base(), actorId: "guest" }, Message.MobileMenu());
  expect(opened.commands).toEqual([]);
  expect(opened.model.invite).toBe(false);
});
