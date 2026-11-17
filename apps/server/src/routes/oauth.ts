import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { db } from "../db/index.js";
import { oauthClients } from "../db/schema.js";
import { env } from "../env.js";
import type { AppEnv } from "../http.js";
import { createApiToken, hashToken, randomString } from "../lib/tokens.js";

/*
 * OAuth 2.1 for the MCP server, as MCP clients (Claude, Claude Code, the MCP Inspector…) expect it:
 *
 *   1. /mcp answers 401 with a WWW-Authenticate header pointing to the protected-resource metadata (RFC 9728).
 *   2. The client reads the authorization-server metadata (RFC 8414) and registers itself (RFC 7591).
 *   3. The person approves the client on Calepin's consent page (/oauth/authorize, part of the web app),
 *      signing in first if needed. Authorization code + PKCE (S256) only.
 *   4. The client exchanges the code at /oauth/token for an access token.
 *
 * The access token is an ordinary API token named after the client: it shows in Settings → API tokens,
 * where it can be revoked. It doesn't expire, like the tokens people create themselves.
 */

const SCOPE = "calepin";
const CODE_TTL_MS = 10 * 60_000;

const base = () => env.PUBLIC_URL.replace(/\/+$/, "");
export const resourceMetadataUrl = () => `${base()}/.well-known/oauth-protected-resource/mcp`;

/** Authorization codes waiting to be exchanged (single-use, short-lived; kept in memory). */
const codes = new Map<
  string,
  { clientId: string; redirectUri: string; challenge: string; userId: string; expires: number }
>();
function sweep() {
  const now = Date.now();
  for (const [k, v] of codes) if (v.expires < now) codes.delete(k);
}

function cors(c: Context) {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-protocol-version");
}

const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) => {
  cors(c);
  c.header("Cache-Control", "no-store");
  return c.json({ error, error_description: description }, status);
};

/** Redirect URIs must be https, or http on the local machine (desktop clients), and carry no fragment. */
function validRedirect(uri: string) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    // Native apps may use their own scheme (e.g. cursor://), but never script schemes.
    return !["javascript:", "data:", "file:", "vbscript:"].includes(u.protocol);
  } catch {
    return false;
  }
}

const sha256base64url = (s: string) => createHash("sha256").update(s).digest("base64url");

function sameSecret(given: string, hash: string) {
  const a = Buffer.from(hashToken(given));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Request parameters from a form or JSON body. */
async function params(c: Context): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]));
  }
  const form = await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
}

const protectedResource = () => ({
  resource: `${base()}/mcp`,
  authorization_servers: [base()],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ["header"],
  resource_name: "Calepin",
  resource_documentation: `${base()}/`,
});

const authorizationServer = () => ({
  issuer: base(),
  authorization_endpoint: `${base()}/oauth/authorize`,
  token_endpoint: `${base()}/oauth/token`,
  registration_endpoint: `${base()}/oauth/register`,
  scopes_supported: [SCOPE],
  response_types_supported: ["code"],
  response_modes_supported: ["query"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
  service_documentation: `${base()}/`,
});

/** Public endpoints: discovery, client registration and the token exchange. */
export const oauthRoutes = new Hono()
  .options("/.well-known/*", (c) => (cors(c), c.body(null, 204)))
  .options("/oauth/*", (c) => (cors(c), c.body(null, 204)))
  // Clients look the metadata up at the root and at the path-suffixed form (/…/mcp).
  .get("/.well-known/oauth-protected-resource", (c) => (cors(c), c.json(protectedResource())))
  .get("/.well-known/oauth-protected-resource/*", (c) => (cors(c), c.json(protectedResource())))
  .get("/.well-known/oauth-authorization-server", (c) => (cors(c), c.json(authorizationServer())))
  .get("/.well-known/oauth-authorization-server/*", (c) => (cors(c), c.json(authorizationServer())))
  .get("/.well-known/openid-configuration", (c) => (cors(c), c.json(authorizationServer())))

  .post("/oauth/register", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return oauthError(c, "invalid_client_metadata", "Expected a JSON body");
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!redirectUris.length || redirectUris.length > 10 || !redirectUris.every(validRedirect))
      return oauthError(c, "invalid_redirect_uri", "redirect_uris must be https (or http on localhost)");
    const name = (typeof body.client_name === "string" && body.client_name.trim().slice(0, 100)) || "MCP client";
    const method = typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none";
    if (!["none", "client_secret_post", "client_secret_basic"].includes(method))
      return oauthError(c, "invalid_client_metadata", "Unsupported token_endpoint_auth_method");

    const id = `cpc_${randomString(24)}`;
    const secret = method === "none" ? null : `cps_${randomString(40)}`;
    await db
      .insert(oauthClients)
      .values({ id, name, redirectUris, secretHash: secret ? hashToken(secret) : null });
    cors(c);
    c.header("Cache-Control", "no-store");
    return c.json(
      {
        client_id: id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: name,
        redirect_uris: redirectUris,
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: method,
        scope: SCOPE,
      },
      201,
    );
  })

  .post("/oauth/token", async (c) => {
    const p = await params(c);
    // Client credentials: in the body, or HTTP Basic.
    let clientId = p.client_id ?? "";
    let secret = p.client_secret ?? "";
    const basic = c.req.header("authorization");
    if (basic?.toLowerCase().startsWith("basic ")) {
      const [id = "", s = ""] = Buffer.from(basic.slice(6), "base64").toString().split(":");
      clientId = decodeURIComponent(id);
      secret = decodeURIComponent(s);
    }
    if (p.grant_type !== "authorization_code")
      return oauthError(c, "unsupported_grant_type", "Only authorization_code is supported");

    const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId));
    if (!client) return oauthError(c, "invalid_client", "Unknown client", 401);
    if (client.secretHash && !(secret && sameSecret(secret, client.secretHash)))
      return oauthError(c, "invalid_client", "Invalid client secret", 401);

    sweep();
    const entry = codes.get(p.code ?? "");
    codes.delete(p.code ?? ""); // single use, even when the exchange fails
    if (!entry || entry.clientId !== client.id) return oauthError(c, "invalid_grant", "Invalid or expired code");
    if (p.redirect_uri && p.redirect_uri !== entry.redirectUri)
      return oauthError(c, "invalid_grant", "redirect_uri does not match");
    if (!p.code_verifier || sha256base64url(p.code_verifier) !== entry.challenge)
      return oauthError(c, "invalid_grant", "PKCE verification failed");

    const token = await createApiToken(entry.userId, client.name);
    cors(c);
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    return c.json({ access_token: token.token, token_type: "Bearer", scope: SCOPE });
  });

const authorizeQuery = z.object({
  response_type: z.literal("code"),
  client_id: z.string().min(1),
  redirect_uri: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
});

async function checkRequest(input: unknown) {
  const parsed = authorizeQuery.safeParse(input);
  if (!parsed.success)
    return { error: "This sign-in link is incomplete: the app must use the authorization code flow with PKCE." };
  const q = parsed.data;
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.id, q.client_id));
  if (!client) return { error: "This app isn't registered with Calepin. Try connecting it again." };
  const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri))
    return { error: "The app's return address doesn't match the one it registered." };
  return { q, client, redirectUri };
}

/** Consent page support (signed-in browser session only). */
export const oauthApiRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    if (c.var.viaToken) return c.json({ error: "Approve apps from the browser" }, 403);
    await next();
  })
  /** What the consent page shows: the client's name and where it will send you back. */
  .post("/oauth/check", async (c) => {
    const res = await checkRequest(await c.req.json());
    if ("error" in res) return c.json({ error: res.error }, 400);
    return c.json({ clientName: res.client.name, redirectHost: new URL(res.redirectUri).host });
  })
  /** Approve or deny; returns where to send the browser. */
  .post("/oauth/decide", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const res = await checkRequest(body);
    if ("error" in res) return c.json({ error: res.error }, 400);
    const url = new URL(res.redirectUri);
    if (res.q.state) url.searchParams.set("state", res.q.state);
    url.searchParams.set("iss", base());
    if (body.approve !== true) {
      url.searchParams.set("error", "access_denied");
      return c.json({ redirect: url.toString() });
    }
    sweep();
    const code = randomString(48);
    codes.set(code, {
      clientId: res.client.id,
      redirectUri: res.redirectUri,
      challenge: res.q.code_challenge,
      userId: c.var.user.id,
      expires: Date.now() + CODE_TTL_MS,
    });
    url.searchParams.set("code", code);
    return c.json({ redirect: url.toString() });
  });
