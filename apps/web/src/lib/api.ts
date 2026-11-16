export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/* ---------- Types shared with the server ---------- */

export type Role = "owner" | "editor" | "viewer";

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  workspaces: { id: string; name: string; icon: string | null; role: Role }[];
};

export type AppConfig = { allowSignup: boolean; oidc: { name: string } | null };

export type PageSummary = {
  id: string;
  parentId: string | null;
  position: string;
  type: "page" | "database" | "row";
  title: string;
  icon: string | null;
  updatedAt: string;
  createdAt: string;
};

export type SearchResult = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  updatedAt: string;
  snippet: string;
};

export type TrashItem = { id: string; title: string; icon: string | null; deletedAt: string; parentId: string | null };
