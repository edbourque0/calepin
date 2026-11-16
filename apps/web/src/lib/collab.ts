import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

/** Must match apps/server/src/lib/ydoc.ts */
export const BLOCKS_FRAGMENT = "blocks";
export const TITLE_TEXT = "title";

export type SyncStatus = "connecting" | "synced" | "saving" | "offline";

export type Collab = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  local: IndexeddbPersistence;
};

function collabUrl() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/collab`;
}

/**
 * One Yjs document per page, synced with the server through Hocuspocus and cached
 * locally in IndexedDB so pages open instantly and keep working offline.
 */
export function useCollab(pageId: string) {
  const [collab, setCollab] = useState<Collab | null>(null);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [readOnly, setReadOnly] = useState(false);
  const [denied, setDenied] = useState(false);
  const [localReady, setLocalReady] = useState(false);

  useEffect(() => {
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(`calepin:${pageId}`, doc);
    local.whenSynced.then(() => setLocalReady(true));

    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: pageId,
      document: doc,
      // Authentication happens with the session cookie; the token only triggers the auth handshake.
      token: "session",
    });

    const update = () => {
      if (provider.configuration.websocketProvider.status !== "connected")
        setStatus(provider.isSynced ? "offline" : navigator.onLine ? "connecting" : "offline");
      else if (!provider.isSynced) setStatus("connecting");
      else setStatus(provider.hasUnsyncedChanges ? "saving" : "synced");
    };
    provider.on("status", update);
    provider.on("synced", update);
    provider.on("unsyncedChanges", update);
    provider.on("authenticated", ({ scope }: { scope: string }) => setReadOnly(scope === "readonly"));
    provider.on("authenticationFailed", () => setDenied(true));
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    setCollab({ doc, provider, local });
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      provider.destroy();
      local.destroy();
      doc.destroy();
      setCollab(null);
    };
  }, [pageId]);

  return { collab, status, readOnly, denied, ready: localReady || status !== "connecting" };
}

export type Presence = { clientId: number; name: string; color: string };

/** Other people currently on the page, from the Yjs awareness channel. */
export function usePresence(provider: HocuspocusProvider | undefined) {
  const [people, setPeople] = useState<Presence[]>([]);
  useEffect(() => {
    const awareness = provider?.awareness;
    if (!awareness) return;
    const update = () => {
      const list: Presence[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === awareness.clientID || !state.user) return;
        list.push({ clientId, name: state.user.name, color: state.user.color });
      });
      setPeople(list);
    };
    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [provider]);
  return people;
}
