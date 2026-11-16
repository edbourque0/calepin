import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, type Me, type PageSummary, type SharedPage } from "./api";
import { storage } from "./utils";

type Workspace = Me["workspaces"][number];
type WorkspaceCtx = {
  me: Me;
  workspace: Workspace;
  setWorkspace: (id: string) => void;
  canEdit: boolean;
};
const Ctx = createContext<WorkspaceCtx | null>(null);
const currentStore = storage<string | null>("workspace", null);

export function WorkspaceProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [currentId, setCurrentId] = useState(currentStore.get);
  const workspace = me.workspaces.find((w) => w.id === currentId) ?? me.workspaces[0]!;

  const setWorkspace = useCallback((id: string) => {
    currentStore.set(id);
    setCurrentId(id);
  }, []);

  const value = useMemo(
    () => ({ me, workspace, setWorkspace, canEdit: workspace.role !== "viewer" }),
    [me, workspace, setWorkspace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

export const pagesKey = (wid: string) => ["pages", wid] as const;
export const sharedKey = ["shared"] as const;

export function usePages() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: pagesKey(workspace.id),
    queryFn: () => api.get<PageSummary[]>(`/workspaces/${workspace.id}/pages`),
    refetchInterval: 120_000,
  });
}

/** Pages other people shared with me (guest access), as a forest of shared roots. */
export function useSharedPages() {
  return useQuery({ queryKey: sharedKey, queryFn: () => api.get<SharedPage[]>("/shared"), refetchInterval: 60_000 });
}

/** Refreshes the page tree when the server says the workspace changed (another person or an agent). */
export function useWorkspaceEvents() {
  const { workspace } = useWorkspace();
  const qc = useQueryClient();
  useEffect(() => {
    const source = new EventSource(`/api/workspaces/${workspace.id}/events`, { withCredentials: true });
    source.addEventListener("pages", () => {
      qc.invalidateQueries({ queryKey: pagesKey(workspace.id) });
      qc.invalidateQueries({ queryKey: ["page"] });
    });
    return () => source.close();
  }, [workspace.id, qc]);
}

/* ---------- Tree helpers ---------- */

const byPosition = (a: PageSummary, b: PageSummary) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.createdAt < b.createdAt ? -1 : 1;

export type PageIndex = {
  byId: Map<string, PageSummary>;
  children: (parentId: string | null) => PageSummary[];
  ancestors: (id: string) => PageSummary[];
};

export function buildIndex(list: PageSummary[] | undefined): PageIndex {
  const byId = new Map<string, PageSummary>();
  const kids = new Map<string | null, PageSummary[]>();
  for (const p of list ?? []) {
    byId.set(p.id, p);
    const arr = kids.get(p.parentId) ?? [];
    arr.push(p);
    kids.set(p.parentId, arr);
  }
  for (const arr of kids.values()) arr.sort(byPosition);
  return {
    byId,
    children: (parentId) => kids.get(parentId) ?? [],
    ancestors: (id) => {
      const chain: PageSummary[] = [];
      let cur = byId.get(id);
      const seen = new Set<string>();
      while (cur?.parentId && !seen.has(cur.parentId)) {
        seen.add(cur.parentId);
        cur = byId.get(cur.parentId);
        if (cur) chain.unshift(cur);
      }
      return chain;
    },
  };
}

export function usePageIndex(): PageIndex {
  const { data } = usePages();
  return useMemo(() => buildIndex(data), [data]);
}

export function useSharedIndex(): PageIndex {
  const { data } = useSharedPages();
  return useMemo(() => buildIndex(data), [data]);
}

/* ---------- Mutations ---------- */

export function usePageActions() {
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const key = pagesKey(workspace.id);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: sharedKey });
  };

  const patchLocal = (id: string, patch: Partial<PageSummary>) => {
    const apply = (old?: PageSummary[]) => old?.map((p) => (p.id === id ? { ...p, ...patch } : p));
    qc.setQueryData<PageSummary[]>(key, apply);
    qc.setQueryData<SharedPage[]>(sharedKey, (old) => apply(old) as SharedPage[] | undefined);
  };

  const create = useMutation({
    mutationFn: (body: { parentId?: string | null; title?: string; workspaceId?: string }) =>
      api.post<PageSummary>(`/workspaces/${body.workspaceId ?? workspace.id}/pages`, {
        parentId: body.parentId,
        title: body.title,
      }),
    onSuccess: (page) => {
      if (page.workspaceId === workspace.id) qc.setQueryData<PageSummary[]>(key, (old) => [...(old ?? []), page]);
      else qc.invalidateQueries({ queryKey: sharedKey });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ ids: string[] }>(`/pages/${id}`),
    onSuccess: ({ ids }) => {
      qc.setQueryData<PageSummary[]>(key, (old) => old?.filter((p) => !ids.includes(p.id)));
      qc.invalidateQueries({ queryKey: ["trash", workspace.id] });
    },
  });

  const move = useMutation({
    mutationFn: ({ id, parentId, index }: { id: string; parentId: string | null; index: number }) =>
      api.patch<PageSummary>(`/pages/${id}`, { move: { parentId, index } }),
    onSuccess: (page) => patchLocal(page.id, page),
    onError: invalidate,
  });

  const setIcon = useMutation({
    mutationFn: ({ id, icon }: { id: string; icon: string | null }) => api.patch<PageSummary>(`/pages/${id}`, { icon }),
    onMutate: ({ id, icon }) => patchLocal(id, { icon }),
    onError: invalidate,
  });

  return { create, remove, move, setIcon, patchLocal, invalidate };
}
