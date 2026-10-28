import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import policy from "../../config/watcher.json";

/** Applied before registration, so platform mutations never reach the client. */
export function applyWatcherPolicy(server: McpServer): void {
  const register: (...args: any[]) => any = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: any, handler: any) => {
    if (policy.disabled_tool_prefixes.some((p) => name.startsWith(p)) || policy.disabled_tools.includes(name)) return;
    const journal = name === "collector_run" || name === "collector_ack";
    const safeMailRead = name === "mail_read";
    if (policy.read_only_platforms && !journal && !safeMailRead && config.annotations?.readOnlyHint !== true) return;
    if (safeMailRead) {
      return register(name, { ...config, annotations: { ...config.annotations, readOnlyHint: true } },
        (args: any, extra: any) => handler({ ...args, mark_as_read: false }, extra));
    }
    return register(name, config, handler);
  }) as typeof server.registerTool;
}
