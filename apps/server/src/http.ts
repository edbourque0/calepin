import { createMiddleware } from "hono/factory";
import { auth, type SessionUser } from "./auth.js";

export type AppEnv = { Variables: { user: SessionUser } };

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  await next();
});
