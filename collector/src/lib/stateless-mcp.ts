import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/** OAuth runs first. Each request has an isolated server and no persisted protocol state. */
export function statelessMcpHandler(createServer: (env: Env) => McpServer,
  ownerAllowed: (env: Env, login: string | undefined) => boolean) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const props = ctx.props;
      const login = props && typeof props === "object" && "login" in props && typeof props.login === "string" ? props.login : undefined;
      if (!ownerAllowed(env, login)) return new Response("Forbidden", { status: 403 });
      const headers = { "Cache-Control": "private, no-store", "Allow": "POST, DELETE, OPTIONS" };
      const origin = request.headers.get("Origin");
      if (origin && origin !== new URL(request.url).origin) return new Response("Forbidden origin", { status: 403, headers });
      // No server-push stream; 405 tells clients not to reconnect GET SSE.
      if (request.method === "GET") return new Response(null, { status: 405, headers });
      if (request.method === "DELETE" || request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (request.method !== "POST") return new Response(null, { status: 405, headers });
      const server = createServer(env);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, enableJsonResponse: true,
      });
      try {
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      } finally { await server.close(); }
    },
  };
}
