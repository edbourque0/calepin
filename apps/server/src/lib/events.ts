import { EventEmitter } from "node:events";

/** In-process pub/sub used to tell open clients that something in a workspace changed. */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export type WorkspaceEvent = { type: "pages" } | { type: "database"; id: string } | { type: "reset" };

export function emitWorkspace(workspaceId: string, event: WorkspaceEvent = { type: "pages" }) {
  bus.emit(`ws:${workspaceId}`, event);
}

export function emitDatabase(workspaceId: string, databaseId: string) {
  emitWorkspace(workspaceId, { type: "database", id: databaseId });
}

export function onWorkspace(workspaceId: string, listener: (e: WorkspaceEvent) => void) {
  bus.on(`ws:${workspaceId}`, listener);
  return () => {
    bus.off(`ws:${workspaceId}`, listener);
  };
}

/** Tells every open client to drop its local cache and reload (after a full restore). */
export function emitReset() {
  bus.emit("global", { type: "reset" } satisfies WorkspaceEvent);
}

export function onGlobal(listener: (e: WorkspaceEvent) => void) {
  bus.on("global", listener);
  return () => {
    bus.off("global", listener);
  };
}
