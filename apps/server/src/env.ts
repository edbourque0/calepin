import { z } from "zod";

const schema = z.object({
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET must be at least 16 characters"),
  ALLOW_SIGNUP: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  OIDC_DISCOVERY_URL: z.string().optional().default(""),
  OIDC_CLIENT_ID: z.string().optional().default(""),
  OIDC_CLIENT_SECRET: z.string().optional().default(""),
  OIDC_PROVIDER_NAME: z.string().optional().default("SSO"),
  WEB_DIST: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const oidcEnabled = Boolean(env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID);
