# Calepin

A self-hosted notebook: pages, live collaboration, offline-ready PWA — with databases, version history, backups and public pages on the way. Runs on your own Docker host.

## Features

- **Block editor** (BlockNote): slash commands, headings, lists, to-dos, quotes, code, tables, images
- **Live collaboration**: Yjs + Hocuspocus over a single WebSocket, with live cursors and presence
- **Offline first**: every page is cached in IndexedDB, edits made offline sync when you reconnect
- **Page tree**: nested pages, drag-and-drop to reorder or nest, emoji icons
- **Search** (`Ctrl/⌘ K`): Postgres full-text search, accent-insensitive ("ete" finds "Été"), with highlighted snippets
- **Trash**: deleted pages (and their subpages) can be restored or deleted forever
- **Accounts**: email + password, optional OIDC single sign-on (Pocket ID, Authentik, Keycloak…)
- **Workspaces & members**: several workspaces per person, owner / editor / viewer roles, invitations by email or link
- **Page sharing**: share a page (and its subpages) with people outside the workspace, read-only or editable
- **Publish to the web**: read-only public pages at `/s/<slug>`, rendered on the server
- **Live tree**: the sidebar updates instantly when someone (or an agent) adds, renames or moves pages
- **API tokens + MCP server**: let AI assistants and automations (n8n, scripts) read and write your notes
- **Installable PWA**, light/dark/system themes (`Ctrl/⌘ ⇧ L`), French and English

## Run it

```bash
curl -O https://raw.githubusercontent.com/edbourque0/calepin/main/docker-compose.yml
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" > .env
echo "PUBLIC_URL=https://notes.example.com" >> .env
docker compose up -d
```

Open `PUBLIC_URL` and create your account. To stop others from signing up afterwards, set `ALLOW_SIGNUP=false` (the first account can always be created).

The image is built by GitHub Actions and published to `ghcr.io/edbourque0/calepin`. To build locally instead: `docker compose build`.

Calepin works behind a reverse proxy or Cloudflare Tunnel; it needs WebSockets on `/collab`.

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:3000` | URL people use to reach Calepin (auth callbacks, cookies) |
| `BETTER_AUTH_SECRET` | — | Required. Random secret for sessions |
| `DATABASE_URL` | set by compose | PostgreSQL connection string |
| `ALLOW_SIGNUP` | `true` | Allow new accounts to register |
| `OIDC_DISCOVERY_URL` | — | e.g. `https://id.example.com/.well-known/openid-configuration` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | OIDC client credentials |
| `OIDC_PROVIDER_NAME` | `SSO` | Label on the sign-in button |

For OIDC, register the redirect URI `PUBLIC_URL/api/auth/callback/oidc` with your identity provider.

## MCP server

Calepin exposes an [MCP](https://modelcontextprotocol.io) server at `PUBLIC_URL/mcp` (Streamable HTTP, stateless).
Create a token in **Settings → API tokens**, then add the server to your client:

```json
{
  "mcpServers": {
    "calepin": {
      "type": "http",
      "url": "https://notes.example.com/mcp",
      "headers": { "Authorization": "Bearer cp_…" }
    }
  }
}
```

Tools: `list_workspaces`, `search_pages`, `list_pages`, `get_page` (Markdown), `create_page`, `append_to_page`,
`replace_page_content`, `update_page` (rename, icon, move), `delete_page` (to the trash). Agents act with your
permissions, and their edits appear live to anyone viewing the page.

The same tokens work for the REST API (`Authorization: Bearer cp_…` on any `/api` route).

## Development

Requirements: Node 22, pnpm 10, PostgreSQL 16+.

```bash
pnpm install
cp .env.example .env            # then set DATABASE_URL and BETTER_AUTH_SECRET
pnpm dev                        # API + collab on :3000, web on :5173 (proxied)
```

| Path | What |
| --- | --- |
| `apps/server` | Hono API, Better Auth, Hocuspocus (Yjs) server, Drizzle schema and migrations |
| `apps/web` | React + Vite SPA, BlockNote editor, Tailwind v4 themed by the Calepin design system (`src/tokens.css`) |

After changing `apps/server/src/db/schema.ts`, run `pnpm db:generate` to create a migration. Migrations run automatically at startup.

### Architecture notes

- Each page is a Yjs document (`blocks` XML fragment + `title` text). Hocuspocus persists the full state to `pages.yjs_state` and a plain-text projection to `pages.content_text`, which feeds the `search` tsvector.
- Page order uses fractional indexing (`position`, sorted with `COLLATE "C"`), so moves never rewrite siblings.
- Structured data (databases, coming in Phase 3) will live in Postgres, not in Yjs.

## Roadmap

1. ~~Foundation — auth, page tree, collaborative editor, search, Docker image~~
2. ~~Collaboration — sharing and permissions, multiple users, public pages, MCP server~~
3. Databases — properties, table/board views, relations, rollups
4. Safety — version history, built-in backup/restore, export
5. Import & mobile polish — Notion import, Markdown export
6. Extras — formulas, timeline view, API/webhooks, AI
