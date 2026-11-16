import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/* ---------- Better Auth tables ---------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ---------- Workspaces ---------- */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  icon: text("icon"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkspaceRole = "owner" | "editor" | "viewer";

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)],
);

/* ---------- Pages ---------- */

export type PageType = "page" | "database" | "row";

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => pages.id, { onDelete: "cascade" }),
    /** Fractional index used to order siblings without rewriting them. */
    position: text("position").notNull(),
    type: text("type").$type<PageType>().notNull().default("page"),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    /** Full Yjs document state (BlockNote content + title). */
    yjsState: bytea("yjs_state"),
    /** Plain-text projection of the document, used for search and previews. */
    contentText: text("content_text").notNull().default(""),
    search: tsvector("search").generatedAlwaysAs(
      sql`setweight(to_tsvector('calepin'::regconfig, coalesce("title", '')), 'A') || setweight(to_tsvector('calepin'::regconfig, coalesce("content_text", '')), 'B')`,
    ),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Database rows: property values keyed by property id (relations live in db_relations). */
    props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
    /** Set when the page is published to the web at /s/<publicSlug>. */
    publicSlug: text("public_slug").unique(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("pages_workspace_parent_idx").on(t.workspaceId, t.parentId),
    index("pages_search_idx").using("gin", t.search),
  ],
);

/* ---------- Sharing ---------- */

export type ShareRole = "editor" | "viewer";

/** Access to a page (and its subpages) for people who are not members of the workspace. */
export const pageShares = pgTable(
  "page_shares",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").$type<ShareRole>().notNull().default("viewer"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] }), index("page_shares_user_idx").on(t.userId)],
);

/**
 * Invitation links. With pageId null it invites to the workspace (role = workspace role);
 * with pageId set it shares that page (role = share role).
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: text("token").notNull().unique(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => pages.id, { onDelete: "cascade" }),
    email: text("email"),
    role: text("role").$type<WorkspaceRole | ShareRole>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [index("invites_workspace_idx").on(t.workspaceId)],
);

/* ---------- API tokens (REST + MCP) ---------- */

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** SHA-256 of the token; the token itself is shown once and never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters, to recognise a token in the list. */
    prefix: text("prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

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

/** Columns of a database (a page with type "database"). The title column is the row page's title. */
export const dbProperties = pgTable(
  "db_properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<PropertyType>().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    position: text("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("db_properties_database_idx").on(t.databaseId)],
);

/** Relation links. Two-way relations store one link per direction, each under its own property. */
export const dbRelations = pgTable(
  "db_relations",
  {
    propertyId: uuid("property_id")
      .notNull()
      .references(() => dbProperties.id, { onDelete: "cascade" }),
    fromRow: uuid("from_row")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    toRow: uuid("to_row")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    position: text("position").notNull().default("a0"),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.fromRow, t.toRow] }), index("db_relations_from_idx").on(t.fromRow)],
);

export type ViewType = "table" | "board" | "list" | "gallery";

export const dbViews = pgTable(
  "db_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    databaseId: uuid("database_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<ViewType>().notNull().default("table"),
    /** { filters, sorts, groupBy, hidden, widths } */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    position: text("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("db_views_database_idx").on(t.databaseId)],
);
