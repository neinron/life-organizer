// Separate entry point: never deployed by the production Wrangler configuration.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerOwnerTools, SERVER_VERSION } from "./index";
import policy from "../config/watcher.json";
export { CollectorRunner } from "./index";

type LocalEnv = Env & { LOCAL_RUNTIME_TOKEN?: string };
export default {
  async fetch(request: Request, env: LocalEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response("Local only", { status: 403 });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return new Response("Origin denied", { status: 403 });
    if (!env.LOCAL_RUNTIME_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.LOCAL_RUNTIME_TOKEN}`)
      return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/health") return Response.json({ status: "ok", owner: policy.owner, version: SERVER_VERSION, mode: "local", enabled_sources: policy.enabled_sources });
    if (url.pathname !== "/mcp") return new Response("Not found", { status: 404 });
    const server = new McpServer({ name: "TUM Watcher — Example User", version: SERVER_VERSION }, { instructions: policy.instructions });
    registerOwnerTools(server, env);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  }
} satisfies ExportedHandler<LocalEnv>;
