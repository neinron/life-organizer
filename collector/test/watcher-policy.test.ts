import { describe, expect, it, vi } from "vitest";
import { applyWatcherPolicy } from "../src/lib/watcher-policy";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("Example User watcher boundary", () => {
  it("never exposes sends, submissions, scoreboard or implicit read receipts", () => {
    const registered = new Map<string, any>();
    const server = { registerTool: (name: string, config: any, handler: any) => registered.set(name, { config, handler }) } as unknown as McpServer;
    applyWatcherPolicy(server);
    for (const name of ["mail_send", "moodle_assignment_submit_text", "artemis_repo_commit", "tumonline_request_token"])
      server.registerTool(name, { annotations: { readOnlyHint: false } }, vi.fn());
    for (const name of ["its_scoreboard_task", "public_its_scoreboard", "artemis_messages", "moodle_probe"])
      server.registerTool(name, { annotations: { readOnlyHint: true } }, vi.fn());
    expect(registered.size).toBe(0);
    server.registerTool("collector_run", { annotations: { readOnlyHint: false } }, vi.fn());
    server.registerTool("collector_ack", { annotations: { readOnlyHint: false } }, vi.fn());
    server.registerTool("moodle_courses", { annotations: { readOnlyHint: true } }, vi.fn());
    expect([...registered.keys()]).toEqual(["collector_run", "collector_ack", "moodle_courses"]);
  });
  it("forces mail reads to preserve unread state even if the caller asks otherwise", async () => {
    let wrapped: any;
    const handler = vi.fn();
    const server = { registerTool: (_n: string, _c: any, h: any) => { wrapped = h; } } as unknown as McpServer;
    applyWatcherPolicy(server);
    server.registerTool("mail_read", { annotations: { readOnlyHint: false } }, handler);
    await wrapped({ uid: 7, mark_as_read: true }, {});
    expect(handler).toHaveBeenCalledWith({ uid: 7, mark_as_read: false }, {});
  });
});
