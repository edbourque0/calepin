import { createMiddleware } from "hono/factory";
import { auth } from "./auth.js";
import { type AppUser, bearer, userFromToken } from "./lib/tokens.js";

export type AppEnv = { Variables: { user: AppUser; viaToken: boolean } };

/** Authenticates with the session cookie, or with a personal access token (Authorization: Bearer cp_…). */
export async function resolveUser(headers: Headers): Promise<{ user: AppUser; viaToken: boolean } | null> {
  const token = bearer(headers);
  if (token) {
    const user = await userFromToken(token);
    return user ? { user, viaToken: true } : null;
  }
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const { id, name, email, image } = session.user;
  return { user: { id, name, email, image: image ?? null }, viaToken: false };
}

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const resolved = await resolveUser(c.req.raw.headers);
  if (!resolved) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", resolved.user);
  c.set("viaToken", resolved.viaToken);
  await next();
});
