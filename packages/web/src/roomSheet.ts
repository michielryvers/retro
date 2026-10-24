// Native modal behavior supplies focus containment, Escape and an inert board.
export const installRoomSheet = () => {
  const mobile = matchMedia("(max-width: 900px)");
  let sheet: HTMLDialogElement | null = null;
  let modal = false;

  const sync = () => {
    const next = document.querySelector<HTMLDialogElement>("#room-sheet");

    if (!next) {
      sheet = null;
      modal = false;
      document.documentElement.classList.remove("room-sheet-open");

      return;
    }

    if (next !== sheet) {
      sheet = next;
      modal = false;

      const dismiss = () =>
        next.querySelector<HTMLButtonElement>(".room-sheet-close")?.click();

      next.addEventListener("cancel", (event) => {
        event.preventDefault();
        dismiss();
      });
      next.addEventListener("click", (event) => {
        if (event.target !== next) return;
        const rect = next.getBoundingClientRect();

        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dismiss();
      });
    }

    if (mobile.matches) {
      const active = next.classList.contains("sheet-active");

      if (active && (!modal || !next.open)) {
        if (next.open) next.close();
        next.showModal();
        modal = true;
        next.querySelector<HTMLButtonElement>(".room-sheet-close")?.focus();
      } else if (!active && next.open) {
        next.close();
        modal = false;
      }
    } else {
      if (modal) {
        next.close();
        modal = false;
      }

      if (!next.open) next.show();
    }

    document.documentElement.classList.toggle(
      "room-sheet-open",
      mobile.matches && modal,
    );
  };

  new MutationObserver(sync).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "open"],
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet?.matches(":modal")) {
      event.preventDefault();
      sheet.querySelector<HTMLButtonElement>(".room-sheet-close")?.click();
    }
  });

  const fitViewport = () => {
    const viewport = window.visualViewport;

    if (!viewport) return;
    document.documentElement.style.setProperty(
      "--room-sheet-height",
      `${viewport.height * 0.85}px`,
    );
    document.documentElement.style.setProperty(
      "--room-sheet-bottom",
      `${Math.max(0, innerHeight - viewport.height - viewport.offsetTop)}px`,
    );
  };

  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);
  fitViewport();
  mobile.addEventListener("change", sync);
  sync();
};
