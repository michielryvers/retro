import { describe, expect, it } from "vitest";
import { emptyBoard, type BoardState } from "../../domain/src/Room/Values";
import { phaseConfirmation, availableVotes } from "../src/roomProgress";

const room: BoardState = {
  ...emptyBoard,
  participants: [
    { id: "a", name: "A", ready: true },
    { id: "b", name: "B", ready: true },
  ],
  notes: [{ id: "n", column: "mad", text: "Note", authorId: "a" }],
  tally: { mad: 1, sad: 0, glad: 0 },
};

describe("room-aware confirmations", () => {
  it("celebrates readiness without a zero-person warning", () => {
    expect(phaseConfirmation(room, "reveal")).toContain("Everyone is ready.");
    expect(phaseConfirmation(room, "reveal")).not.toContain("0 people");
  });
  it("names actual unfinished writers with correct grammar", () =>
    expect(
      phaseConfirmation(
        {
          ...room,
          participants: [
            room.participants[0]!,
            { ...room.participants[1]!, ready: false },
          ],
        },
        "reveal",
      ),
    ).toContain("1 person is still writing"));
  it("counts available notes and acknowledges completed voting", () => {
    expect(availableVotes(room)).toBe(1);
    expect(
      phaseConfirmation({ ...room, voters: ["a", "b"] }, "finishVote"),
    ).toContain("Everyone has finished voting.");
  });
  it("distinguishes unfinished votes and empty boards", () => {
    expect(
      phaseConfirmation({ ...room, voters: ["a"] }, "finishVote"),
    ).toContain("1 person is still voting");
    expect(phaseConfirmation({ ...room, notes: [] }, "finishVote")).toContain(
      "There are no notes",
    );
  });
  it("flags missing owners, not intentionally unfinished actions", () => {
    const action = {
      id: "x",
      noteId: "n",
      text: "Do it",
      ownerId: "",
      dueDate: "",
      done: false,
    };

    expect(
      phaseConfirmation({ ...room, actions: [action] }, "close"),
    ).toContain("1 action still needs an owner");
    expect(
      phaseConfirmation(
        { ...room, actions: [{ ...action, ownerId: "a" }] },
        "close",
      ),
    ).toContain("All action items have an owner");
    expect(phaseConfirmation(room, "close")).not.toContain("complete actions");
    expect(phaseConfirmation(room, "close")).toContain("review and export");
  });
});
