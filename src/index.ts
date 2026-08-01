import { FastMCP } from "fastmcp";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { registerAllTools } from "./tools/registerTools.js";

const server = new FastMCP({
  name: "INDUSS Research Intelligence",
  version: "0.1.0",
});

registerAllTools(server);

async function main() {
  if (env.MCP_TRANSPORT === "httpStream") {
    await server.start({
      transportType: "httpStream",
      httpStream: {
        port: env.MCP_HTTP_PORT,
        endpoint: "/mcp",
        ...(env.MCP_AUTH_TOKEN
          ? {
              authenticate: async (req: Request) => {
                const auth = req.headers.get("authorization") ?? "";
                const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
                if (token !== env.MCP_AUTH_TOKEN) {
                  throw new Response("Unauthorized", { status: 401 });
                }
                return {}; // session context
              },
            }
          : {}),
      },
    });
    logger.info({ port: env.MCP_HTTP_PORT }, "INDUSS MCP server listening (httpStream)");
  } else {
    await server.start({ transportType: "stdio" });
    logger.info("INDUSS MCP server listening (stdio)");
  }
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start INDUSS MCP server");
  process.exit(1);
});
