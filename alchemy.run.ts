import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import RetroWorker from "./packages/server/src/RetroWorker.ts";

export default Alchemy.Stack(
  "CommonGround",
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Effect.map(Alchemy.Stage, (stage) =>
        stage === "prod"
          ? Cloudflare.state({ name: "retro" })
          : Alchemy.localState(),
      ),
    ),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;

    const domain =
      stage === "prod"
        ? yield* Config.NonEmptyString("RETRO_DOMAIN")
        : undefined;

    const email =
      stage === "prod" ? yield* Config.NonEmptyString("RETRO_ADMIN_EMAIL") : "";

    const issuer =
      stage === "prod" ? yield* Config.NonEmptyString("RETRO_ACCESS_ISSUER") : "";

    const access =
      stage === "prod"
        ? yield* Cloudflare.Access.Application("RetroAdminAccess", {
            type: "self_hosted",
            name: "Common Ground administration",
            domain: `${domain}/admin`,
            sessionDuration: "12h",
            httpOnlyCookieAttribute: true,
            policies: [
              {
                name: "Administrator",
                decision: "allow",
                include: [{ email }],
              },
            ],
          })
        : { aud: "local-disabled" };

    const backend = yield* RetroWorker;

    const app = yield* Cloudflare.Website.Foldkit("CommonGroundApp", {
      rootDir: "packages/web",
      domain,
      main: "src/worker.ts",
      observability: { enabled: true, redactQueryString: true },
      env: {
        BACKEND: backend,
        ADMIN_AUD: access.aud,
        ADMIN_EMAIL: email,
        ACCESS_ISSUER: issuer,
        LOCAL_ADMIN: stage === "prod" ? "false" : "true",
      },
      assets: {
        notFoundHandling: "single-page-application",
        runWorkerFirst: ["/api", "/api/*", "/admin", "/admin/*"],
      },
      dev: { host: "127.0.0.1", port: 5187, strictPort: true },
    });

    return { url: app.url.as<string>(), api: backend.url.as<string>() };
  }),
);
