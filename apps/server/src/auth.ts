import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { count } from "drizzle-orm";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";
import { env, oidcEnabled } from "./env.js";
import { findValidInvite } from "./lib/invites.js";
import { createPersonalWorkspace } from "./lib/workspaces.js";

export const OIDC_PROVIDER_ID = "oidc";

export const auth = betterAuth({
  baseURL: env.PUBLIC_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.PUBLIC_URL, "http://localhost:5173"],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: oidcEnabled
    ? [
        genericOAuth({
          config: [
            {
              providerId: OIDC_PROVIDER_ID,
              discoveryUrl: env.OIDC_DISCOVERY_URL,
              clientId: env.OIDC_CLIENT_ID,
              clientSecret: env.OIDC_CLIENT_SECRET,
              scopes: ["openid", "profile", "email"],
              pkce: true,
            },
          ],
        }),
      ]
    : [],
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (env.ALLOW_SIGNUP) return { data: user };
          // The very first account can always be created, so a fresh install is usable.
          const [{ value }] = await db.select({ value: count() }).from(schema.user);
          if (value === 0) return { data: user };
          // People holding a valid invitation link can create an account even when sign-up is closed.
          const headers = ctx?.headers ?? ctx?.request?.headers;
          const token = headers?.get("cookie")?.match(/(?:^|;\s*)calepin_invite=([^;]+)/)?.[1];
          if (token && (await findValidInvite(decodeURIComponent(token)))) return { data: user };
          return false;
        },
        after: async (user) => {
          await createPersonalWorkspace(user.id, user.name);
          // The first account of an instance administers it (backups…).
          const admins = await db.select().from(schema.instanceAdmins).limit(1);
          if (!admins.length) await db.insert(schema.instanceAdmins).values({ userId: user.id }).onConflictDoNothing();
        },
      },
    },
  },
});

export type SessionUser = typeof auth.$Infer.Session.user;
