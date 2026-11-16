import { EventEmitter } from "node:events";

/** In-process pub/sub used to tell open clients that a workspace's page tree changed. */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export type WorkspaceEvent = { type: "pages" };

export function emitWorkspace(workspaceId: string, event: WorkspaceEvent = { type: "pages" }) {
  bus.emit(`ws:${workspaceId}`, event);
}

export function onWorkspace(workspaceId: string, listener: (e: WorkspaceEvent) => void) {
  bus.on(`ws:${workspaceId}`, listener);
  return () => {
    bus.off(`ws:${workspaceId}`, listener);
  };
}
