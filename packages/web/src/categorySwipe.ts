// Reuse category buttons so swipe navigation follows the same draft guards.
export const installCategorySwipe = () => {
  let start: { x: number; y: number; time: number; board: Element } | undefined;
  let horizontal = false;
  let feedback: HTMLElement | undefined;
  let offset = 0;
  let settling: Animation | undefined;

  const tabsFor = (board: Element) =>
    Array.from(
      board.parentElement?.querySelectorAll<HTMLButtonElement>(
        ".column-tabs button",
      ) ?? [],
    );

  const reset = () => {
    if (feedback) {
      feedback.style.removeProperty("translate");
      settling?.cancel();

      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        settling = feedback.animate(
          [{ translate: `${offset}px 0` }, { translate: "0px 0" }],
          { duration: 180, easing: "ease-out" },
        );
      feedback = undefined;
      offset = 0;
    }

    start = undefined;
    horizontal = false;
  };

  document.addEventListener(
    "touchstart",
    (event) => {
      reset();

      if (
        !matchMedia("(max-width: 900px)").matches ||
        event.touches.length !== 1 ||
        !(event.target instanceof Element)
      )
        return;

      if (
        event.target.closest(
          "button, input, textarea, select, a, [contenteditable], .action-form",
        )
      )
        return;

      // The workspace and shell also own the empty area below a short board.
      const board =
        event.target.closest(".board") ??
        (event.target.matches(".workspace, .app-shell")
          ? event.target.querySelector(".board")
          : null);

      const touch = event.touches[0]!;

      // Leave the browser's edge/back gestures alone.
      if (
        !board ||
        !board.getClientRects().length ||
        touch.clientY < board.getBoundingClientRect().top ||
        touch.clientX < 24 ||
        touch.clientX > innerWidth - 24
      )
        return;

      if (
        document.activeElement?.matches(
          "input, textarea, select, [contenteditable]",
        )
      )
        return;
      start = {
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
        board,
      };
    },
    { passive: true },
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (!start) return;

      if (
        event.touches.length !== 1 ||
        (performance.now() - start.time >= 300 && !horizontal) ||
        start.board.querySelector(".is-dragging")
      ) {
        reset();

        return;
      }

      const touch = event.touches[0]!;

      const dx = Math.abs(touch.clientX - start.x),
        dy = Math.abs(touch.clientY - start.y);

      if (!horizontal) {
        if (Math.max(dx, dy) < 12) return;

        if (dx < dy * 1.5) {
          reset();

          return;
        }

        horizontal = true;
      }

      if (event.cancelable) event.preventDefault();

      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const distance = touch.clientX - start.x;
      const tabs = tabsFor(start.board);

      const current = tabs.findIndex(
        (tab) => tab.getAttribute("aria-pressed") === "true",
      );

      const hasNeighbor = Boolean(tabs[current + (distance < 0 ? 1 : -1)]);

      feedback ??=
        start.board.querySelector<HTMLElement>(".mobile-active") ?? undefined;

      if (!feedback) return;
      settling?.cancel();
      // Resistance keeps the board in view and makes the first/last edge feel firm.
      offset =
        Math.sign(distance) *
        Math.min(Math.abs(distance) * (hasNeighbor ? 0.45 : 0.12), 96);
      feedback.style.translate = `${offset}px 0`;
    },
    { passive: false },
  );

  document.addEventListener(
    "touchend",
    (event) => {
      const gesture = start;
      const touch = event.changedTouches[0];
      const isHorizontal = horizontal;
      reset();

      if (
        !gesture ||
        !touch ||
        !isHorizontal ||
        performance.now() - gesture.time > 700 ||
        gesture.board.querySelector(".is-dragging")
      )
        return;
      const dx = touch.clientX - gesture.x;

      if (
        Math.abs(dx) < 48 ||
        Math.abs(dx) < Math.abs(touch.clientY - gesture.y) * 1.5
      )
        return;

      const tabs = tabsFor(gesture.board);

      const current = tabs.findIndex(
        (tab) => tab.getAttribute("aria-pressed") === "true",
      );

      if (current < 0) return;
      tabs[current + (dx < 0 ? 1 : -1)]?.click();
    },
    { passive: true },
  );
  document.addEventListener("touchcancel", reset, { passive: true });
};
