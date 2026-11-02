import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { statelessMcpHandler } from "../src/lib/stateless-mcp";

vi.mock("@cloudflare/workers-oauth-provider", () => ({ default: class {}, AuthorizationError: class extends Error {}, CimdFetchError: class extends Error {} }));
vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkerEntrypoint: class {} }));
const { createOwnerServer, TumMCP } = await import("../src/index");
const env = new Proxy({ ALLOWED_GITHUB_LOGIN: "example-owner" }, {
  get(target, name) {
    if (name === "MCP_OBJECT") throw Error("Protocol must never access Durable Objects");
    return Reflect.get(target, name);
  },
}) as unknown as Env;
const ctx = { props: { login: "example-owner" }, waitUntil: vi.fn() } as unknown as ExecutionContext;
const allowed = (_env: Env, login?: string) => login === "example-owner";
const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" };
function request(method: string, body?: unknown, extra: Record<string,string> = {}) {
  return new Request("https://organizer.example.com/mcp", { method, headers: {...headers,...extra}, body: body ? JSON.stringify(body) : undefined });
}
function fixtureServer() {
  const s = new McpServer({ name: "fixture", version: "1" });
  s.registerTool("fixture_read", { annotations: { readOnlyHint: true } }, async () => ({content:[{type:"text",text:"saved fixture"}]}));
  return s;
}

describe("stateless MCP transport", () => {
  it("supports real SDK initialize, tools/list, tools/call and close without sessions or DO storage", async () => {
    const handler = statelessMcpHandler(fixtureServer, allowed);
    const transport = new StreamableHTTPClientTransport(new URL("https://organizer.example.com/mcp"), {
      fetch: (input, init) => handler.fetch(new Request(input,init), env,ctx),
    });
    const client = new Client({name:"regression-client",version:"1"});
    await client.connect(transport);
    expect(transport.sessionId).toBeUndefined();
    expect((await client.listTools()).tools.map(t=>t.name)).toEqual(["fixture_read"]);
    expect((await client.callTool({name:"fixture_read",arguments:{}})).content).toEqual([{type:"text",text:"saved fixture"}]);
    await client.close();
  });

  it("handles repeated parallel connection cycles without creating persisted sessions", async () => {
    const handler = statelessMcpHandler(fixtureServer, allowed);
    await Promise.all(Array.from({length:30}, async (_, i) => {
      for (const body of [
        {jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"fixture",version:"1"}}},
        {jsonrpc:"2.0",id:2,method:"tools/list",params:{}},
        {jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"fixture_read",arguments:{}}},
      ]) {
        const response = await handler.fetch(request("POST",body,{"mcp-session-id":`old-session-${i}`}),env,ctx);
        expect(response.status).toBe(200);
        expect(response.headers.has("mcp-session-id")).toBe(false);
        expect((await response.json() as any).error).toBeUndefined();
      }
      expect((await handler.fetch(request("GET"),env,ctx)).status).toBe(405);
      expect((await handler.fetch(request("DELETE"),env,ctx)).status).toBe(204);
    }));
  });

  it("rejects absent/wrong identity and cross-origin requests before registering tools", async () => {
    const factory = vi.fn(fixtureServer);
    const handler = statelessMcpHandler(factory,allowed);
    for (const props of [undefined,{login:"someone-else"}]) {
      expect((await handler.fetch(request("POST",{}),env,{props} as any)).status).toBe(403);
    }
    expect((await handler.fetch(request("POST",{},{Origin:"https://other.example.com"}),env,ctx)).status).toBe(403);
    expect(factory).not.toHaveBeenCalled();
  });

  it("keeps the real tool restrictions and server metadata in independently recreated servers", async () => {
    const handler = statelessMcpHandler(createOwnerServer,allowed);
    const r=await handler.fetch(request("POST",{jsonrpc:"2.0",id:1,method:"tools/list",params:{}}),env,ctx);
    const names=(await r.json() as any).result.tools.map((t:any)=>t.name);
    expect(names).toContain("server_info");
    expect(names).toContain("collector_run");
    expect(names).not.toContain("mail_send");
    expect(names).not.toContain("artemis_repo_commit");
  });

  it("acknowledges legacy cleanup alarms without touching storage", async () => {
    const retired = new TumMCP({storage:new Proxy({}, {get(){throw Error("No storage writes allowed");}})} as any,env);
    await retired.alarm();
    expect((await retired.fetch()).status).toBe(410);
  });
});
