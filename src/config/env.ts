import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  EXA_API_KEY: z.string().min(1, "EXA_API_KEY is required"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  MCP_TRANSPORT: z.enum(["stdio", "httpStream"]).default("stdio"),
  MCP_HTTP_PORT: z.coerce.number().int().positive().default(8080),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DATABASE_URL: z.string().optional(),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  EXA_MAX_CONCURRENCY: z.coerce.number().int().positive().default(5),
  EXA_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(60),
  /** OAuth 2.1 (GitHub) — only required for the httpStream transport in
   *  production (e.g. Railway). Left unset, the server runs with no auth,
   *  which is expected for local stdio dev via Claude Desktop/Cursor. */
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  OAUTH_ENCRYPTION_KEY: z.string().optional(),
  OAUTH_JWT_SIGNING_KEY: z.string().optional(),
  MCP_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
