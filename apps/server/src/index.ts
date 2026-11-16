import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { ZodError } from "zod";
import { auth } from "./auth.js";
import { handleCollabUpgrade, hocuspocus } from "./collab.js";
import { client, runMigrations } from "./db/index.js";
import { env, oidcEnabled } from "./env.js";
import { type AppEnv, requireUser } from "./http.js";
import { pageRoutes } from "./routes/pages.js";
import { workspaceRoutes } from "./routes/workspaces.js";

await runMigrations();

const app = new Hono<AppEnv>();

app.use("/api/*", logger());

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/config", (c) =>
  c.json({ allowSignup: env.ALLOW_SIGNUP, oidc: oidcEnabled ? { name: env.OIDC_PROVIDER_NAME } : null }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const api = new Hono<AppEnv>().use(requireUser).route("/", workspaceRoutes).route("/", pageRoutes);
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

/* ----- Web app (built SPA) ----- */
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist =
  env.WEB_DIST ?? [path.resolve(here, "../../web/dist"), path.resolve(here, "../web")].find((p) => existsSync(p));

if (webDist && existsSync(path.join(webDist, "index.html"))) {
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.use(
    "/assets/*",
    serveStatic({
      root: path.relative(process.cwd(), webDist),
      onFound: (_p, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
    }),
  );
  app.use("*", serveStatic({ root: path.relative(process.cwd(), webDist) }));
  app.get("*", (c) => c.html(indexHtml));
} else {
  app.get("/", (c) => c.text("Calepin API is running. Start the web app with `pnpm dev`."));
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Calepin listening on http://localhost:${info.port}`);
});

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/collab") handleCollabUpgrade(req, socket, head);
  else socket.destroy();
});

async function shutdown() {
  console.log("Shutting down…");
  hocuspocus.flushPendingStores();
  await new Promise((r) => setTimeout(r, 500));
  server.close();
  await client.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
