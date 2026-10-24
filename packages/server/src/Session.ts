import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { Room } from "@retro/domain/Room/Room.aggregate";
import { PreparedAccess } from "@retro/domain/PreparedAccess.context";
import { prepareAccess, AccessPayload } from "./PrepareAccess.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpServerRequest } from "effect/http/HttpServerRequest";
import * as Response from "effect/http/HttpServerResponse";
import { CurrentActor } from "@retro/domain/CurrentActor.context";
import { Session, Unauthorized } from "@retro/domain/Session.middleware";

export const cookieToken = (headers: Readonly<Record<string, string>>) =>
  /(?:^|;\s*)__Host-cg_session=([a-f0-9]{64})(?:;|$)/.exec(
    headers.cookie ?? "",
  )?.[1];

// The random cookie is the credential; only its one-way hash is ever public.
// No signing key or session database is needed. A chosen token cannot impersonate
// a participant without finding a SHA-256 preimage.
export const identity = (token: string) =>
  Effect.promise(async () =>
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
      ),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join(""),
  );

export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const rooms = yield* Room;

    return (effect, { headers, rpc, payload }) => {
      const token = cookieToken(headers);

      return token
        ? Effect.flatMap(identity(token), (id) =>
            Effect.flatMap(
              prepareAccess(
                rpc._tag,
                Option.getOrNull(
                  Schema.decodeUnknownOption(AccessPayload)(payload),
                ),
              ).pipe(Effect.provideService(Room, rooms)),
              (prepared) =>
                effect.pipe(
                  Effect.provideService(CurrentActor, { id }),
                  Effect.provideService(PreparedAccess, prepared),
                ),
            ),
          )
        : Effect.fail(new Unauthorized());
    };
  }),
);

export const sessionRoute = Effect.gen(function* () {
  const request = yield* HttpServerRequest;
  let token = cookieToken(request.headers);

  if (!token)
    token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  const id = yield* identity(token);

  return Response.jsonUnsafe(
    { id },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": `__Host-cg_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000; Secure`,
      },
    },
  );
});
