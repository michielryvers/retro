import type { BoardState } from "@retro/domain/Room/Values";

export const availableVotes = (board: BoardState) =>
  Math.min(board.voteLimit, board.notes.length);

export function phaseConfirmation(board: BoardState, op: string): string {
  const total = board.participants.length;

  if (op === "reveal") {
    const waiting = total - board.participants.filter((p) => p.ready).length;

    const progress =
      waiting === 0
        ? "Everyone is ready."
        : `${waiting} ${waiting === 1 ? "person is" : "people are"} still writing.`;

    const count = Object.values(board.tally).reduce((sum, count) => sum + count, 0);

    return `${progress} ${count === 0 ? "There are no notes to reveal." : `Reveal ${count} ${count === 1 ? "note" : "notes"} to everyone?`} Note editing will close.`;
  }

  if (op === "startVote")
    return board.notes.length === 0
      ? "There are no notes to vote on. You can move through voting to wrap up the session."
      : `Everyone can choose up to ${availableVotes(board)} ${availableVotes(board) === 1 ? "note" : "notes"}. Choices and totals stay private until voting ends.`;

  if (op === "finishVote") {
    const waiting = total - board.voters.length;

    const progress =
      availableVotes(board) === 0
        ? "There are no notes to vote on."
        : waiting === 0
          ? "Everyone has finished voting."
          : `${waiting} ${waiting === 1 ? "person is" : "people are"} still voting. People can choose Done voting with unused votes.`;

    return `${progress} Show the results and close voting?`;
  }

  const unassigned = board.actions.filter((a) => !a.ownerId).length;

  return `${board.actions.length === 0 ? "No action items have been captured yet." : unassigned > 0 ? `${unassigned} ${unassigned === 1 ? "action still needs" : "actions still need"} an owner.` : "All action items have an owner."} Close the retrospective? You can still review and export the summary afterwards.`;
}
