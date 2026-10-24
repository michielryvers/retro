export type VoteSort = "highest" | "lowest" | "original";

export function sortByVotes<T>(
  items: readonly T[],
  order: VoteSort,
  count: (item: T) => number,
): T[] {
  return order === "original"
    ? [...items]
    : items.toSorted((a, b) =>
        order === "highest" ? count(b) - count(a) : count(a) - count(b),
      );
}
