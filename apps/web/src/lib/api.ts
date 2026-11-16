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
  workspaceId: string;
  parentId: string | null;
  publicSlug: string | null;
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

export type SharedPage = PageSummary & { role: "editor" | "viewer" };

export type PageMeta = PageSummary & {
  role: Role;
  isMember: boolean;
  ancestors: { id: string; title: string; icon: string | null }[];
};

export type Sharing = {
  canManage: boolean;
  workspace: { name: string; members: number };
  guests: {
    userId: string;
    name: string;
    email: string;
    role: "editor" | "viewer";
    pageId: string;
    pageTitle: string;
  }[];
  invites: { id: string; email: string | null; role: string; url: string; createdAt: string }[];
  published: { slug: string; publishedAt: string } | null;
};

export type Members = {
  myRole: Role;
  members: { userId: string; name: string; email: string; role: Role; joinedAt: string }[];
  invites: { id: string; email: string | null; role: Role; url: string; expiresAt: string }[];
};

export type ApiToken = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null };

export type InviteInfo = {
  valid: boolean;
  kind: "page" | "workspace";
  role: string;
  workspace: string;
  page: { title: string; icon: string | null } | null;
  inviter: string | null;
  email: string | null;
};
