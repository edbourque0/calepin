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
import { mcpRoutes } from "./mcp.js";
import { getEpoch } from "./lib/backup.js";
import { startScheduler } from "./lib/scheduler.js";
import { adminRoutes } from "./routes/admin.js";
import { databaseRoutes } from "./routes/databases.js";
import { exportRoutes } from "./routes/export.js";
import { fileRoutes, fileUploadRoutes } from "./routes/files.js";
import { inviteRoutes } from "./routes/invites.js";
import { pageRoutes } from "./routes/pages.js";
import { publicRoutes } from "./routes/public.js";
import { sharingRoutes } from "./routes/sharing.js";
import { tokenRoutes } from "./routes/tokens.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { aiRoutes } from "./routes/ai.js";
import { aiReady, getAiSettings } from "./lib/ai.js";
import { versionRoutes } from "./routes/versions.js";
import { workspaceRoutes } from "./routes/workspaces.js";

await runMigrations();

/* ----- Command line: `node dist/index.js backup` / `node dist/index.js restore <file>` ----- */
const [command, arg] = process.argv.slice(2);
if (command === "backup" || command === "restore") {
  const { runBackup, restoreDatabase } = await import("./lib/backup.js");
  let code = 0;
  try {
    if (command === "backup") {
      const run = await runBackup("manual");
      console.log(
        run.status === "success"
          ? `Backup written: ${run.fileName} (${run.targets.join(", ")})`
          : `Backup failed: ${run.error}`,
      );
      code = run.status === "success" ? 0 : 1;
    } else {
      if (!arg) throw new Error("Usage: restore <backup file>");
      const { readFile } = await import("node:fs/promises");
      const before = await runBackup("before-restore");
      console.log(`Safety backup: ${before.fileName ?? before.error}`);
      const result = await restoreDatabase(await readFile(arg));
      console.log(`Restored backup from ${result.createdAt}`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    code = 1;
  }
  await client.end({ timeout: 5 });
  process.exit(code);
}

const app = new Hono<AppEnv>();

app.use("/api/*", logger());

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "Invalid request", issues: err.issues }, 400);
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/config", async (c) =>
  c.json({
    allowSignup: env.ALLOW_SIGNUP,
    oidc: oidcEnabled ? { name: env.OIDC_PROVIDER_NAME } : null,
    epoch: await getEpoch(),
    ai: aiReady(await getAiSettings()),
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api", inviteRoutes);
app.route("/", fileRoutes);

const api = new Hono<AppEnv>()
  .use(requireUser)
  .route("/", workspaceRoutes)
  .route("/", pageRoutes)
  .route("/", sharingRoutes)
  .route("/", databaseRoutes)
  .route("/", versionRoutes)
  .route("/", exportRoutes)
  .route("/", adminRoutes)
  .route("/", fileUploadRoutes)
  .route("/", webhookRoutes)
  .route("/", aiRoutes)
  .route("/", tokenRoutes);
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

/* ----- MCP server (Streamable HTTP, bearer token) ----- */
app.route("/", mcpRoutes);

/* ----- Web app (built SPA) and public pages ----- */
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist =
  env.WEB_DIST ?? [path.resolve(here, "../../web/dist"), path.resolve(here, "../web")].find((p) => existsSync(p));
const appCss =
  webDist && existsSync(path.join(webDist, "index.html"))
    ? (readFileSync(path.join(webDist, "index.html"), "utf8").match(/href="(\/assets\/[^"]+\.css)"/)?.[1] ?? null)
    : null;
app.route("/", publicRoutes(appCss));

if (webDist && existsSync(path.join(webDist, "index.html"))) {
  const indexHtml = readFileSync(path.join(webDist, "index.html"), "utf8");
  app.use(
    "/assets/*",
    serveStatic({
      root: path.relative(process.cwd(), webDist),
      onFound: (_p, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
    }),
  );
  // The service worker, its loader, the manifest and the HTML must never be cached (by the browser or a
  // proxy such as Cloudflare), or installed apps keep running an old version.
  app.use(
    "*",
    serveStatic({
      root: path.relative(process.cwd(), webDist),
      onFound: (p, c) => {
        if (/(^|\/)(sw\.js|registerSW\.js|manifest\.webmanifest|index\.html)$/.test(p) || p.endsWith("/"))
          c.header("Cache-Control", "no-cache, no-store, must-revalidate");
        else c.header("Cache-Control", "public, max-age=3600");
      },
    }),
  );
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache, no-store, must-revalidate");
    return c.html(indexHtml);
  });
} else {
  app.get("/", (c) => c.text("Calepin API is running. Start the web app with `pnpm dev`."));
}

startScheduler();

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
