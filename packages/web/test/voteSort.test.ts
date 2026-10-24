import { expect, it } from "vitest";
import { sortByVotes } from "../src/voteSort";

const notes = [
  { id: "a", votes: 1 },
  { id: "b", votes: 3 },
  { id: "c", votes: 0 },
  { id: "d", votes: 3 },
];

it("sorts counts in both directions with stable ties without mutating source order", () => {
  expect(
    sortByVotes(notes, "highest", (n) => n.votes).map((n) => n.id),
  ).toEqual(["b", "d", "a", "c"]);
  expect(sortByVotes(notes, "lowest", (n) => n.votes).map((n) => n.id)).toEqual(
    ["c", "a", "b", "d"],
  );
  expect(
    sortByVotes(notes, "original", (n) => n.votes).map((n) => n.id),
  ).toEqual(["a", "b", "c", "d"]);
  expect(notes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
});

it("sorts actions by their source note votes including zero-vote notes", () => {
  const actions = [{ noteId: "c" }, { noteId: "b" }, { noteId: "a" }];
  expect(
    sortByVotes(
      actions,
      "highest",
      (a) => notes.find((n) => n.id === a.noteId)?.votes ?? 0,
    ).map((a) => a.noteId),
  ).toEqual(["b", "a", "c"]);
});
