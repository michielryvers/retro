// Translate a deliberate long-press drag into the same room commands as mouse drag.
// Ordinary swipes remain page scrolling; controls inside a card remain tappable.
export const installTouchDrag = () => {
  let sourceId = "";
  let active = false;
  let startX = 0;
  let startY = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const source = () => document.getElementById(sourceId);

  const send = (element: Element | null, type: string) =>
    element?.dispatchEvent(
      new DragEvent(type, { bubbles: true, cancelable: true }),
    );

  const reset = () => {
    clearTimeout(timer);

    if (active) send(source(), "dragend");
    sourceId = "";
    active = false;
  };

  document.addEventListener(
    "touchstart",
    (event) => {
      reset();

      if (event.touches.length !== 1 || !(event.target instanceof Element))
        return;

      if (event.target.closest("button, input, textarea, select, a")) return;
      const card = event.target.closest('.note[draggable="true"]');

      if (!card?.id) return;
      sourceId = card.id;
      startX = event.touches[0]!.clientX;
      startY = event.touches[0]!.clientY;
      timer = setTimeout(() => {
        active = true;
        send(source(), "dragstart");
      }, 350);
    },
    { passive: true },
  );
  document.addEventListener(
    "touchmove",
    (event) => {
      if (!sourceId) return;
      const touch = event.touches[0];

      if (!touch || event.touches.length !== 1) {
        reset();

        return;
      }

      if (!active) {
        if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10)
          reset();

        return;
      }

      event.preventDefault();
      send(
        document
          .elementFromPoint(touch.clientX, touch.clientY)
          ?.closest('.note[draggable="true"]') ?? null,
        "dragover",
      );
    },
    { passive: false },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      if (active) {
        event.preventDefault();
        const touch = event.changedTouches[0];

        if (touch)
          send(
            document
              .elementFromPoint(touch.clientX, touch.clientY)
              ?.closest('.note[draggable="true"]') ?? null,
            "drop",
          );
      }

      reset();
    },
    { passive: false },
  );
  document.addEventListener("touchcancel", reset, { passive: true });
  document.addEventListener("contextmenu", (event) => {
    if (sourceId) event.preventDefault();
  });
};
