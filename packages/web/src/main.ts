import { installRoomSheet } from "./roomSheet.ts";
import { updateWithDrafts } from "./draftPersistence.ts";
import { installCategorySwipe } from "./categorySwipe.ts";
import { installKeyboardDrag } from "./keyboardDrag.ts";
import { installTouchDrag } from "./touchDrag.ts";
import * as Schema from "effect/Schema";
import { SessionResponse } from "@retro/domain/HttpContracts";
import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Socket from "effect/socket/Socket";
import { Runtime } from "foldkit";
import { RetroApi } from "@retro/domain/RetroApi.api";
import { Flags, Model, init, view, subscriptions } from "./App.ts";
import "@fontsource-variable/inter";
import "@phosphor-icons/web/regular";
import "./style.css";

const resources = RetroApi.layerClient.pipe(
  Layer.provide(Domain.protocolWebSocket(`${location.origin}/api`)),
  Layer.provide(Socket.layerWebSocketConstructorGlobal),
  Layer.provide(FetchHttpClient.layer),
);

const startup = async () => {
  if (
    location.pathname === "/admin" ||
    location.pathname.startsWith("/admin/")
  ) {
    (await import("./AdminApp.ts")).startAdmin();

    return;
  }

  const response = await fetch("/api/session", { method: "POST" });

  if (!response.ok) throw new Error("Unable to establish a session");

  const { id } = Schema.decodeUnknownSync(SessionResponse)(
    await response.json(),
  );

  const roomId = /^\/room\/([a-zA-Z0-9-]+)$/.exec(location.pathname)?.[1] ?? "";

  const fragment =
    new URLSearchParams(location.hash.slice(1)).get("invite") ?? "";

  let invitation = fragment;

  try {
    if (fragment) sessionStorage.setItem(`cg_invite_${roomId}`, fragment);
    else invitation = sessionStorage.getItem(`cg_invite_${roomId}`) ?? "";
  } catch {}

  if (fragment) history.replaceState(null, "", location.pathname);
  const parts = /^([a-zA-Z0-9-]{1,100})\.([a-f0-9]{64})$/.exec(invitation);
  let name = "";

  try {
    name = localStorage.getItem("cg_name") ?? "";
  } catch {}

  installTouchDrag();
  installCategorySwipe();
  installKeyboardDrag();
  installRoomSheet();

  Runtime.run(
    Runtime.makeApplication({
      Model,
      Flags,
      init,
      update: updateWithDrafts,
      view,
      subscriptions,
      resources,
      container: document.getElementById("root"),
      devTools: false,
    }),
    {
      flags: Effect.succeed({
        actorId: id,
        roomId,
        participantId: parts?.[1] ?? "",
        inviteToken: parts?.[2] ?? "",
        name,
      }),
    },
  );
};

window.addEventListener("hashchange", () => {
  if (new URLSearchParams(location.hash.slice(1)).has("invite"))
    location.reload();
});

startup().catch(() => {
  const root = document.getElementById("root")!;
  const title = document.createElement("h1");
  title.textContent = "Let’s get you connected.";
  const copy = document.createElement("p");
  copy.textContent =
    "We couldn’t reach the server. Check your connection and try again.";
  const retry = document.createElement("button");
  retry.textContent = "Try again";
  retry.onclick = () => location.reload();
  root.className = "startup-error";
  root.replaceChildren(title, copy, retry);
});
