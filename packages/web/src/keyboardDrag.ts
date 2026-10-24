// Keyboard access uses the same validated drag/drop messages as pointer gestures.
export const installKeyboardDrag = () => {
  let sourceId = "";
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  document.body.append(live);

  const send = (element: Element | null, type: string) =>
    element?.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true }),
    );

  const cancel = () => {
    send(document.getElementById(sourceId), "dragend");
    sourceId = "";
  };

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sourceId) {
      event.preventDefault();
      cancel();
      live.textContent = "Grouping cancelled.";

      return;
    }

    const card =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('.note[draggable="true"]')
        : null;

    if (!card || event.target !== card) return;

    if ([" ", "Enter"].includes(event.key)) {
      event.preventDefault();

      if (!sourceId) {
        sourceId = card.id;
        send(card, "dragstart");
        live.textContent = `Picked up ${card.querySelector(".note-text")?.textContent ?? "note"}. Use arrow keys to choose a destination, Enter to combine, or Escape to cancel.`;
      } else if (sourceId === card.id) {
        cancel();
        live.textContent = "Grouping cancelled.";
      } else {
        send(card, "drop");
        cancel();
        live.textContent = "Combining notes.";
      }
    } else if (
      sourceId &&
      ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();

      const cards = Array.from(
        document.querySelectorAll<HTMLElement>('.note[draggable="true"]'),
      ).filter((n) => n.getClientRects().length);

      const index = cards.indexOf(card);
      const delta = ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1;
      const next = cards[(index + delta + cards.length) % cards.length];
      next?.focus();
      send(next ?? null, "dragover");
      live.textContent = `Destination: ${next?.querySelector(".note-text")?.textContent ?? "note"}. Press Enter to combine.`;
    }
  });
};
