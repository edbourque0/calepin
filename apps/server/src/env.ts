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
  /** Where local backups are written. Mount a volume here in Docker. */
  BACKUP_DIR: z.string().default("./data/backups"),
  /** Encrypts backups (AES-256-GCM) when set. Keep it safe: backups can't be restored without it. */
  BACKUP_PASSPHRASE: z.string().optional().default(""),
  /** Optional S3-compatible copy of every backup (AWS, Wasabi, MinIO, R2, Backblaze…). */
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().optional().default("us-east-1"),
  S3_BUCKET: z.string().optional().default(""),
  S3_ACCESS_KEY_ID: z.string().optional().default(""),
  S3_SECRET_ACCESS_KEY: z.string().optional().default(""),
  S3_PREFIX: z.string().optional().default("calepin/"),
  /** Where uploaded files are kept when storage is "local". */
  FILES_DIR: z.string().default("./data/files"),
  MAX_UPLOAD_MB: z.coerce.number().min(1).default(50),
  /** Days of version history to keep (thinned to one per day after a week). */
  VERSION_RETENTION_DAYS: z.coerce.number().int().min(7).default(90),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const oidcEnabled = Boolean(env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID);
export const s3Enabled = Boolean(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
