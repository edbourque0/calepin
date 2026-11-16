import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { count } from "drizzle-orm";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";
import { env, oidcEnabled } from "./env.js";
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
        before: async (user) => {
          if (env.ALLOW_SIGNUP) return { data: user };
          // The very first account can always be created, so a fresh install is usable.
          const [{ value }] = await db.select({ value: count() }).from(schema.user);
          return value === 0 ? { data: user } : false;
        },
        after: async (user) => {
          await createPersonalWorkspace(user.id, user.name);
        },
      },
    },
  },
});

export type SessionUser = typeof auth.$Infer.Session.user;
