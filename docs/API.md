# Calepin REST API

Everything the app does goes through this API, so anything you can click you can script.

## Authentication

Create a personal token in **Settings → API tokens** and send it as a bearer token:

```sh
curl -H "Authorization: Bearer cp_…" https://notes.example.com/api/me
```

A token acts as you: it sees what you can see and edits what you can edit. Tokens can't manage
tokens, backups or storage settings — use the app for those. Revoke a token from the same screen.

Errors come back as `{"error": "message"}` with a 4xx status. Request bodies are JSON.

## Workspaces and pages

| Method   | Path                                  | Notes                                                                 |
| -------- | ------------------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/api/me`                             | You, your workspaces (`id`, `name`, `role`) and whether you're admin. |
| `GET`    | `/api/workspaces/:wid/pages`          | The page tree (pages and databases, not database rows).               |
| `GET`    | `/api/workspaces/:wid/search?q=…`     | Full-text search (accent-insensitive, prefix matches).                |
| `POST`   | `/api/workspaces/:wid/pages`          | `{ "parentId": "…" \| null, "title": "…" }`                           |
| `GET`    | `/api/pages/:id`                      | Page summary with its ancestors and your role.                        |
| `GET`    | `/api/pages/:id/markdown`             | Content as Markdown.                                                  |
| `PATCH`  | `/api/pages/:id`                      | `{ "title"?, "icon"?, "move"?: { "parentId", "index" } }`             |
| `DELETE` | `/api/pages/:id`                      | Moves the page and its subpages to the trash.                         |
| `POST`   | `/api/pages/:id/restore`              | Back from the trash.                                                  |
| `GET`    | `/api/pages/:id/export`               | Markdown file (CSV for a database).                                   |
| `GET`    | `/api/workspaces/:wid/export`         | The whole workspace as a ZIP of Markdown and CSV.                     |
| `GET`    | `/api/pages/:id/versions`             | Version history.                                                      |
| `POST`   | `/api/pages/:id/versions/:vid/restore`| Restores a version as a new change.                                   |
| `POST`   | `/api/pages/:id/files`                | Upload: raw body, `Content-Type` and `x-file-name` headers.           |
| `GET`    | `/api/workspaces/:wid/events`         | Server-sent events: `pages`, `database` (`{ id }`), `reset`.           |

To write page content as Markdown, use the MCP server (`append_to_page`, `replace_page_content`),
which keeps a version of the page before each change.

## Databases

A database is a page of type `database`; each row is a page of type `row` whose values live in
`props`, keyed by property id.

| Method   | Path                                        | Notes                                                               |
| -------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `POST`   | `/api/workspaces/:wid/databases`            | `{ "title", "parentId"?, "properties"?: [{ "name", "type" }] }`     |
| `GET`    | `/api/databases/:id`                        | Properties, views and rows with every value resolved.               |
| `POST`   | `/api/databases/:id/rows`                   | `{ "title"?, "values"?: { "<property name or id>": value } }`       |
| `PATCH`  | `/api/databases/:id/rows/:rowId`            | `{ "title"?, "values"? }`                                           |
| `DELETE` | `/api/databases/:id/rows/:rowId`            | Trash the row.                                                      |
| `POST`   | `/api/databases/:id/properties`             | `{ "name", "type", "config"? }`                                     |
| `PATCH`  | `/api/databases/:id/properties/:propId`     | `{ "name"?, "type"?, "options"?, "config"? }`                       |
| `POST`   | `/api/databases/:id/formula-preview`        | `{ "expression" }` → results on the first rows, or the syntax error. |
| `POST`   | `/api/databases/:id/views`                  | `{ "name", "type": "table"\|"board"\|"gallery"\|"calendar"\|"timeline" }` |

Values are forgiving: select options can be given by name (unknown names become new options),
numbers as strings, dates as `YYYY-MM-DD` or ISO timestamps, relations as row ids, people as user ids.

```sh
curl -X POST https://notes.example.com/api/databases/$DB/rows \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title": "Refonte du site", "values": {"Statut": "En cours", "Budget": 12500, "Échéance": "2026-12-15"}}'
```

### Formulas

Formula properties take `config: { "expression": "…" }` and are computed on the server.

- Read a property with `prop("Name")`; `prop("title")` is the row's title.
- Operators: `+ - * / % ^`, `== != > < >= <=`, `and or not` (or `&& || !`), `cond ? a : b`.
- Logic: `if(cond, a, b)`, `empty(x)`.
- Text: `concat`, `length`, `lower`, `upper`, `trim`, `contains`, `replace`, `slice`, `join`, `format`, `toNumber`.
- Numbers: `round(x, digits)`, `floor`, `ceil`, `abs`, `sqrt`, `pow`, `min`, `max`, `sum`, `average`.
- Dates: `now()`, `today()`, `date("2026-12-01")`, `dateAdd(d, n, "days")`, `dateSubtract`,
  `dateBetween(a, b, "days"|"weeks"|"months"|"years"|"hours")`, `formatDate(d, "DD/MM/YYYY")`,
  `year`, `month`, `day`, `weekday`. Subtracting two dates gives days.

Select values are seen as their option name, multi-selects and relations as lists of names/titles.
An error in one row shows as `{ "error": "…" }` for that row only.

## Webhooks

Workspace owners add webhooks in **Settings → Webhooks** (or `POST /api/workspaces/:wid/webhooks`
with `{ "url", "events"?, "scopePageId"? }`). Calepin POSTs JSON to the URL:

```json
{
  "id": "delivery uuid",
  "event": "row.updated",
  "workspaceId": "…",
  "createdAt": "2026-11-16T19:35:55.479Z",
  "data": {
    "id": "…",
    "type": "row",
    "title": "Refonte du site",
    "url": "https://notes.example.com/p/…",
    "databaseId": "…",
    "database": "Projets",
    "values": { "Statut": "En cours", "Budget": "12500" },
    "properties": { "<property id>": "<raw value>" }
  }
}
```

Events: `page.created`, `page.updated`, `page.deleted`, `row.created`, `row.updated`, `row.deleted`
(pages include databases; `data.type` tells which). Edits are grouped: a burst of typing sends one
`page.updated` a few seconds after the last keystroke, and a row created then filled in sends a single
`row.created`. With `scopePageId`, only that page, its subpages, or that database's rows count.

Each request carries `X-Calepin-Event`, `X-Calepin-Delivery` and `X-Calepin-Signature:
sha256=<hex HMAC-SHA256 of the raw body with the webhook secret>`. Non-2xx answers (5xx, 429) and
network errors are retried after 1 s, 10 s and 60 s. Check the signature before trusting a payload:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = "sha256=" + createHmac("sha256", process.env.CALEPIN_WEBHOOK_SECRET).update(rawBody).digest("hex");
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-calepin-signature"]));
```

`POST /api/webhooks/:id/test` sends a `ping` event once and returns `{ status, error }`.
