import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Hocuspocus } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import { WebSocketServer } from "ws";
import * as Y from "yjs";
import { auth } from "./auth.js";
import { db } from "./db/index.js";
import { pages, type WorkspaceRole } from "./db/schema.js";
import { env } from "./env.js";
import { canEdit, getPageAccess } from "./lib/workspaces.js";
import { emitDatabase, emitWorkspace } from "./lib/events.js";
import { noteAuthor, snapshot } from "./lib/versions.js";
import { notifyUpdated } from "./lib/webhooks.js";
import { extractCover, extractText, getTitle, TITLE_TEXT } from "./lib/ydoc.js";

type Context = { userId: string; role: WorkspaceRole };

/** Set while a full restore replaces the database: live documents must not write back. */
let restoring = false;
export function setRestoring(value: boolean) {
  restoring = value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hocuspocus = new Hocuspocus<Context>({
  name: "calepin",
  debounce: 2000,
  maxDebounce: 10000,
  quiet: true,

  async onConnect() {
    if (restoring) throw new Error("Restoring a backup, try again in a moment");
  },

  async onAuthenticate({ documentName, requestHeaders, connectionConfig }) {
    if (!UUID_RE.test(documentName)) throw new Error("Invalid document");
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session) throw new Error("Unauthorized");
    const access = await getPageAccess(session.user.id, documentName);
    if (!access || access.deletedAt) throw new Error("Forbidden");
    if (!canEdit(access.role)) connectionConfig.readOnly = true;
    return { userId: session.user.id, role: access.role };
  },

  async onLoadDocument({ documentName, document }) {
    const [row] = await db
      .select({ state: pages.yjsState, title: pages.title })
      .from(pages)
      .where(eq(pages.id, documentName));
    if (!row) return document;
    if (row.state) {
      Y.applyUpdate(document, row.state);
    } else if (row.title) {
      // Page created through the API with a title but never opened yet.
      document.getText(TITLE_TEXT).insert(0, row.title);
    }
    return document;
  },

  /** When the last person leaves a page, keep a version of what they did. */
  async onDisconnect({ documentName, document, clientsCount }) {
    if (clientsCount === 0 && !restoring) await snapshot(documentName, document, { force: true }).catch(() => {});
  },

  async onStoreDocument({ documentName, document, lastContext }) {
    if (restoring) return;
    const state = Y.encodeStateAsUpdate(document);
    const title = getTitle(document);
    const cover = extractCover(document);
    const [before] = await db
      .select({
        title: pages.title,
        cover: pages.cover,
        workspaceId: pages.workspaceId,
        type: pages.type,
        parentId: pages.parentId,
      })
      .from(pages)
      .where(eq(pages.id, documentName));
    if (!before) return;
    await db
      .update(pages)
      .set({
        yjsState: state,
        title,
        contentText: extractText(document),
        cover,
        updatedAt: new Date(),
        updatedBy: lastContext?.userId && lastContext.userId !== "system" ? lastContext.userId : undefined,
      })
      .where(eq(pages.id, documentName));
    noteAuthor(documentName, lastContext?.userId);
    notifyUpdated(documentName);
    await snapshot(documentName, document).catch((e) => console.error("[versions]", e));
    if (before.type === "row" && before.parentId) {
      if (before.title !== title || before.cover !== cover) emitDatabase(before.workspaceId, before.parentId);
    } else if (before.title !== title) emitWorkspace(before.workspaceId);
  },
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 50 * 1024 * 1024 });

/** Handles an HTTP upgrade on /collab and hands the socket to Hocuspocus. */
export function handleCollabUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    const request = new Request(new URL(req.url ?? "/collab", env.PUBLIC_URL), { headers });
    const connection = hocuspocus.handleConnection(ws, request);

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      connection.handleMessage(new Uint8Array(buf));
    });
    ws.on("pong", () => connection.touch());
    ws.on("close", (code, reason) => connection.handleClose({ code, reason: reason.toString() }));
    ws.on("error", (err) => console.error("[collab] socket error", err));
  });
}

// Keep idle connections alive through proxies such as Cloudflare Tunnel.
setInterval(() => {
  for (const client of wss.clients) client.ping();
}, 30_000).unref();
