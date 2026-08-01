import { FastMCP } from "fastmcp";
import { GitHubProvider } from "fastmcp/auth";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { registerAllTools } from "./tools/registerTools.js";

// OAuth 2.1 (GitHub) is only wired up when the three required vars are
// present — that's the case in production (Railway, httpStream). Local
// stdio dev via Claude Desktop/Cursor never sets these and runs unauthenticated.
const authProvider =
  env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.MCP_BASE_URL
    ? new GitHubProvider({
        baseUrl: env.MCP_BASE_URL,
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        encryptionKey: env.OAUTH_ENCRYPTION_KEY,
        jwtSigningKey: env.OAUTH_JWT_SIGNING_KEY,
        allowedRedirectUriPatterns: ["https://claude.ai/*"],
        scopes: ["read:user"],
      })
    : undefined;

const server = new FastMCP({
  name: "INDUSS Research Intelligence",
  version: "0.1.0",
  ...(authProvider ? { auth: authProvider } : {}),
  health: { enabled: true, path: "/health" },
});

registerAllTools(server);

async function main() {
  if (env.MCP_TRANSPORT === "httpStream") {
    if (!authProvider) {
      logger.warn(
        "httpStream transport starting with no auth provider configured (GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET/MCP_BASE_URL unset) — the /mcp endpoint is unauthenticated.",
      );
    }
    await server.start({
      transportType: "httpStream",
      httpStream: { port: env.MCP_HTTP_PORT, endpoint: "/mcp" },
    });
    logger.info({ port: env.MCP_HTTP_PORT, oauthEnabled: Boolean(authProvider) }, "INDUSS MCP server listening (httpStream)");
  } else {
    await server.start({ transportType: "stdio" });
    logger.info("INDUSS MCP server listening (stdio)");
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start INDUSS MCP server");
  process.exit(1);
});
