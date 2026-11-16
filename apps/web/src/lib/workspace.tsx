import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { api, type Me, type PageSummary } from "./api";

type WorkspaceCtx = { me: Me; workspace: Me["workspaces"][number] };
const Ctx = createContext<WorkspaceCtx | null>(null);

export function WorkspaceProvider({ me, children }: { me: Me; children: ReactNode }) {
  const value = useMemo(() => ({ me, workspace: me.workspaces[0]! }), [me]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace outside provider");
  return ctx;
}

export const pagesKey = (wid: string) => ["pages", wid] as const;

export function usePages() {
  const { workspace } = useWorkspace();
  return useQuery({
    queryKey: pagesKey(workspace.id),
    queryFn: () => api.get<PageSummary[]>(`/workspaces/${workspace.id}/pages`),
    refetchInterval: 30_000,
  });
}

/* ---------- Tree helpers ---------- */

const byPosition = (a: PageSummary, b: PageSummary) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : a.createdAt < b.createdAt ? -1 : 1;

export type PageIndex = {
  byId: Map<string, PageSummary>;
  children: (parentId: string | null) => PageSummary[];
  ancestors: (id: string) => PageSummary[];
};

export function usePageIndex(): PageIndex {
  const { data } = usePages();
  return useMemo(() => {
    const byId = new Map<string, PageSummary>();
    const kids = new Map<string | null, PageSummary[]>();
    for (const p of data ?? []) {
      byId.set(p.id, p);
      const list = kids.get(p.parentId) ?? [];
      list.push(p);
      kids.set(p.parentId, list);
    }
    for (const list of kids.values()) list.sort(byPosition);
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
  }, [data]);
}

/* ---------- Mutations ---------- */

export function usePageActions() {
  const qc = useQueryClient();
  const { workspace } = useWorkspace();
  const key = pagesKey(workspace.id);
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const patchLocal = (id: string, patch: Partial<PageSummary>) =>
    qc.setQueryData<PageSummary[]>(key, (old) => old?.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const create = useMutation({
    mutationFn: (body: { parentId?: string | null; title?: string }) =>
      api.post<PageSummary>(`/workspaces/${workspace.id}/pages`, body),
    onSuccess: (page) => {
      qc.setQueryData<PageSummary[]>(key, (old) => [...(old ?? []), page]);
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
