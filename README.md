# Calepin

A self-hosted notebook: pages, live collaboration, databases, version history, backups, public pages, webhooks, an MCP
server and an optional AI assistant — as an offline-ready PWA. Runs on your own Docker host.

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
- **Databases**: full-page databases with typed properties (text, number, select, multi-select, status, date,
  checkbox, person, URL, email, phone, created/edited time), two-way **relations** and **rollups**
  (count, sum, average, min/max, % checked, earliest/latest…) and **formulas** (`prop("Prix") * prop("Qté")`,
  `dateBetween(prop("Échéance"), today(), "days")`…). Table, board (Kanban), gallery, calendar and timeline views
  with filters, sorts, grouping and hidden properties; drag to reschedule on the calendar and timeline. Every row is a
  page with its own content, and its first image becomes the gallery cover.
- **Inline databases**: type `/database` in any page to embed a database right there
- **Version history**: a version is kept every 10 minutes of editing, when the last person leaves a page and
  before an AI agent rewrites it. Browse versions, compare them with the page now, restore one (as a new change,
  so nothing is lost and collaborators keep working)
- **Built-in backups**: a daily, optionally encrypted backup of the whole instance, kept on the server and copied to
  any S3-compatible storage; restore from the app or the command line
- **Images and files**: drop, paste or upload images, files, video and audio into any page. Stored on the server or
  in a private S3-compatible bucket (Wasabi, AWS, MinIO…) configured in Settings → Storage
- **Export**: any page as Markdown, any database as CSV, a whole workspace as a ZIP
- **Live tree**: the sidebar updates instantly when someone (or an agent) adds, renames or moves pages
- **API tokens + MCP server**: let AI assistants and automations (n8n, scripts) read and write your notes —
  see the [REST API reference](docs/API.md)
- **Webhooks**: signed HTTP notifications when pages or rows change (Settings → Webhooks)
- **AI assistant** (`Ctrl/⌘ J`, optional): summarize, improve, shorten, continue or translate, and ask questions
  answered from your own notes with links to the sources. Works with Ollama on your server, OpenAI, Anthropic or any
  OpenAI-compatible API (Settings → AI)
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
| `TZ` | `America/Toronto` | Time zone of the daily backup |
| `BACKUP_PASSPHRASE` | — | Encrypts backups (recommended) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PREFIX` | — | Off-site copy of backups |
| `VERSION_RETENTION_DAYS` | `90` | How long page versions are kept |
| `MAX_UPLOAD_MB` | `50` | Maximum size of an uploaded file |
| `MAX_IMPORT_MB` | `500` | Maximum size of an import (zip) |

For OIDC, register the redirect URI `PUBLIC_URL/api/auth/callback/oidc` with your identity provider.

## Images and files

Uploads are kept on the server (`/app/data/files`) or, once configured in **Settings → Storage** (administrators),
in an S3-compatible bucket. There's a Wasabi preset: pick the region, enter the bucket and an access key, test the
connection, save.

The bucket stays **private**: no public-read policy or bucket ACL is needed (Wasabi often refuses public access).
Pages reference files as `/api/files/<id>/<name>` and Calepin streams them from the bucket after checking that the
viewer can see the page; published pages get time-limited signed links so visitors without an account see their
images too. Video and audio seek normally (HTTP range requests are passed through).

- Changing the storage later only affects new uploads; existing files stay readable where they are.
- The S3 secret key is stored encrypted (derived from `BETTER_AUTH_SECRET`; if you change that secret, re-enter the key).
- The same bucket can also receive the backups (under `<prefix>backups/`), unless the `S3_*` variables are set.
- Files of pages deleted forever are removed during the nightly maintenance.
- Backups contain the file list, not the file contents: keep `/app/data/files` (or the bucket) backed up too.

## Backups

Every day at the chosen hour (Settings → Backups, administrators only — the first account is the administrator),
Calepin writes a full backup: accounts, workspaces, pages and their content, databases, version history.

- **Where**: `/app/data/backups` in the container (the `calepin-data` volume), plus an S3-compatible bucket when
  `S3_*` is set (Wasabi, MinIO, Cloudflare R2, Backblaze B2, AWS…). The newest 14 are kept (configurable).
- **Encryption**: set `BACKUP_PASSPHRASE` to encrypt backups with AES-256-GCM. Keep the passphrase somewhere else:
  without it a backup can't be restored.
- **Format**: a gzipped JSON file produced by Postgres itself, independent of the Postgres version. Backups from an
  older Calepin restore into a newer one.
- **Restore** from Settings → Backups (a file listed there or one you upload). Calepin first makes a safety backup
  of the current state, then replaces everything in one transaction; open browsers drop their offline copy and reload.

From the command line:

```bash
docker compose exec calepin node dist/index.js backup
# restore: stop the app first so no open page writes old content back
docker compose stop calepin
docker compose run --rm calepin node dist/index.js restore /app/data/backups/calepin-2026-11-16T08-00-00Z.json.gz.enc
docker compose start calepin
```

Version history is thinned every night: every version from the last day, one per hour for a week, one per day up to
`VERSION_RETENTION_DAYS` (90).

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

Tools:

- **Pages**: `list_workspaces`, `search_pages`, `list_pages`, `get_page` (Markdown), `create_page`,
  `append_to_page`, `replace_page_content`, `update_page` (rename, icon — emoji or `lucide:Name:color` — move),
  `delete_page` (to the trash)
- **Files**: `upload_file` — an image or file as base64 or from a URL, added to the page as an image / video /
  audio / file block (or just uploaded, returning a Markdown snippet)
- **Databases**: `get_database` (schema, views and rows as a Markdown table), `create_database` (optionally
  embedded in its parent page), `add_database_row`, `update_database_row`, `add_database_property` (any type,
  including formulas, relations and rollups), `update_database_property` (rename, formula, new options),
  `add_database_view` (table, board, gallery, calendar, timeline)
- **Webhooks** (workspace owners): `list_webhooks`, `create_webhook`, `delete_webhook`

Agents act with your permissions, and their edits appear live to anyone viewing the page. Before an agent rewrites
a page, Calepin keeps a version of it.

The same tokens work for the REST API (`Authorization: Bearer cp_…` on any `/api` route).

## Import

**Import** in the sidebar takes a `.zip`, a `.md` or a `.csv`, into the top level of the workspace or inside the
page you're on. It runs in the background, so large exports are fine.

- **Notion**: Settings → Export all workspace content (or ••• → Export on one page), format *Markdown & CSV*,
  *Include subpages*. Import the zip as is (Notion's nested `Part-1.zip` files are handled). Pages keep their tree,
  databases become Calepin databases with their rows and row content, links between pages and images follow.
- **Obsidian / Markdown folders**: zip the vault or folder. Folders become pages (a folder note `X/X.md`,
  `index.md` or `README.md` is the folder's own content), `[[links]]`, `[[note|alias]]`, `![[image.png]]` and
  relative Markdown links are converted, front matter becomes a property list at the top of the page.
- **CSV**: becomes a database; the first column is the title and column types (number, date, checkbox, URL,
  email, select, multi-select, text) are detected.

## AI assistant

Off until an administrator sets it up in **Settings → AI**. Pick a provider, check the URL and model, add a key
(not needed for Ollama), **Test**, then **Save**:

| Provider | API URL | Example model |
| --- | --- | --- |
| Ollama (same Docker network) | `http://ollama:11434/v1` | `llama3.2`, `qwen2.5` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1-mini` |
| Anthropic | `https://api.anthropic.com/v1` | `claude-haiku-4-5` |
| Other (OpenRouter, LM Studio, vLLM…) | its `/v1` URL | — |

The key is stored encrypted. When someone uses the assistant, the page (or, for questions about your notes, the
best-matching pages they can see in the workspace) is sent to that provider — use Ollama to keep everything at home.

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
- Structured data lives in Postgres, not in Yjs: a database is a page (`type = 'database'`) with `db_properties`
  and `db_views`; each row is a page (`type = 'row'`) whose values sit in `pages.props` (JSONB). Relations are rows
  in `db_relations` (one per direction for two-way relations); rollups are computed when rows are read. Rich text
  (titles and row content) stays in Yjs.

## Roadmap

1. ~~Foundation — auth, page tree, collaborative editor, search, Docker image~~
2. ~~Collaboration — sharing and permissions, multiple users, public pages, MCP server~~
3. ~~Databases — properties, table/board views, relations, rollups~~
4. ~~Safety — version history, built-in backup/restore, export~~
5. ~~Import & mobile polish — Notion import, Markdown / Obsidian import, phone layout~~
6. ~~Extras — formulas, calendar/gallery/timeline views, inline databases, API/webhooks, AI~~
