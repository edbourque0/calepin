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
  /** Instance administrator (backups). */
  isAdmin?: boolean;
};

export type AppConfig = { allowSignup: boolean; oidc: { name: string } | null; epoch: string };

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

/* ---------- Databases ---------- */

export type PropertyType =
  | "text"
  | "number"
  | "select"
  | "multi_select"
  | "status"
  | "date"
  | "checkbox"
  | "url"
  | "email"
  | "phone"
  | "person"
  | "relation"
  | "rollup"
  | "created_time"
  | "last_edited_time";

export type TagColor = "gray" | "amber" | "green" | "blue" | "rose";
export type SelectOption = { id: string; name: string; color: TagColor };

export type Property = {
  id: string;
  databaseId: string;
  name: string;
  type: PropertyType;
  config: {
    options?: SelectOption[];
    format?: "number" | "percent" | "dollar";
    databaseId?: string;
    pairedPropertyId?: string | null;
    relationPropertyId?: string;
    targetPropertyId?: string;
    fn?: RollupFn;
    [k: string]: unknown;
  };
  position: string;
};

export type RollupFn =
  | "count"
  | "count_values"
  | "count_unique"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "show_original"
  | "percent_checked"
  | "earliest"
  | "latest";

export type Filter = { propertyId: string; op: string; value?: unknown };
export type Sort = { propertyId: string; dir: "asc" | "desc" };
export type ViewType = "table" | "board" | "list" | "gallery";
export type ViewConfig = {
  filters?: Filter[];
  filterMode?: "and" | "or";
  sorts?: Sort[];
  groupBy?: string | null;
  hidden?: string[];
};
export type View = {
  id: string;
  databaseId: string;
  name: string;
  type: ViewType;
  config: ViewConfig;
  position: string;
};

export type LinkedRow = { id: string; title: string; icon: string | null };

export type Row = {
  id: string;
  databaseId: string;
  title: string;
  icon: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  props: Record<string, unknown>;
};

export type DatabaseData = {
  database: { id: string; workspaceId: string; title: string; icon: string | null };
  role: Role;
  properties: Property[];
  views: View[];
  rows: Row[];
  people: { id: string; name: string; email: string }[];
  related: { id: string; title: string; icon: string | null }[];
};
