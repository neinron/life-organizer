import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { statelessMcpHandler } from "./lib/stateless-mcp";
import { GitHubHandler, isAllowedLogin } from "./auth/github";
import { registerArtemisTools } from "./platforms/artemis";
import { registerArtemisSubmitTools } from "./platforms/artemis-submit";
import { registerItsScoreboardTools } from "./platforms/its-scoreboard";
import { registerMailFolderTools, registerMailTools } from "./platforms/mail";
import { registerMoodleTools } from "./platforms/moodle";
import { registerMoodleFeedTools } from "./platforms/moodle-feeds";
import { registerMoodleWebTools } from "./platforms/moodle-web";
import { registerServerInfoTool } from "./platforms/server-info";
import { registerStatusTool } from "./platforms/status";
import { registerTumonlineTools } from "./platforms/tumonline";
import { registerTumonlineExamTools } from "./platforms/tumonline-exams";
import { registerTumonlinePersonalTools } from "./platforms/tumonline-personal";
import { registerTumliveTools } from "./platforms/tumlive";
import { registerZulipTools } from "./platforms/zulip";
import { registerZulipExtraTools } from "./platforms/zulip-extra";
import { runAll, runUnit, type UnitRun } from "./collector/runner";
import { DOWNLOAD_PATH, handleDownload } from "./collector/download";
import { registerCollectorTools } from "./collector/tools";
import { applyWatcherPolicy } from "./lib/watcher-policy";
import watcherPolicy from "../config/watcher.json";
import { isQuietHours } from "./lib/quiet-hours";

import { registerNetsecMetadataTools } from "./collector/units/netsec";
import { registerMoodleMediaTools } from "./platforms/moodle-media";
import { registerGitlabMetadataTools } from "./platforms/gitlab-metadata";

export const SERVER_VERSION = "0.10.0-life.2";

type Register = (server: McpServer, env: Env) => void;

// Every tool group is registered on each authenticated request, also when a platform has no secrets.
// The tools then answer "not configured" instead of being missing.
const TOOL_GROUPS: [string, Register][] = [
	["status", registerStatusTool],
	["mail", registerMailTools],
	["mail (folders, drafts)", registerMailFolderTools],
	["zulip", registerZulipTools],
	["zulip (more)", registerZulipExtraTools],
	["tumonline (public)", registerTumonlineTools],
	["tumonline (public exams)", registerTumonlineExamTools],
	["tumonline (personal)", registerTumonlinePersonalTools],
	["moodle", registerMoodleTools],
	["moodle (web pages)", registerMoodleWebTools],
	["moodle (feeds)", registerMoodleFeedTools],
	["artemis", registerArtemisTools],
	["artemis (submissions)", registerArtemisSubmitTools],
	["tumlive", registerTumliveTools],
	["its scoreboard", registerItsScoreboardTools],
	["collector", registerCollectorTools],
	["netsec metadata", registerNetsecMetadataTools],
	["lecture video metadata", registerMoodleMediaTools],
	["GitLab repository metadata", registerGitlabMetadataTools],
];

export function registerOwnerTools(server: McpServer, env: Env) {
  applyWatcherPolicy(server);
  const failed: string[] = [];
  for (const [name, register] of TOOL_GROUPS) {
    try { register(server, env); }
    catch (e) { failed.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  registerServerInfoTool(server, env, SERVER_VERSION, failed);
}

/** Retained so old protocol-only objects drain alarms without further writes.
 * Source data is stored separately. Preserve the namespace in this hotfix.
 */
export class TumMCP extends DurableObject<Env> {
  async alarm(): Promise<void> { /* Acknowledge old cleanup alarms without storage writes. */ }
  async fetch(): Promise<Response> { return new Response("MCP sessions retired", { status: 410 }); }
  async webSocketMessage(ws: WebSocket): Promise<void> { ws.close(1001, "MCP sessions retired"); }
  async webSocketClose(): Promise<void> {}
  async webSocketError(): Promise<void> {}
}

export function createOwnerServer(env: Env): McpServer {
  const server = new McpServer({ name: "Life Organizer", version: SERVER_VERSION }, { instructions: watcherPolicy.instructions });
  registerOwnerTools(server, env);
  return server;
}

/** One collector unit per invocation. Called by runAll through the COLLECTOR service binding. */
export class CollectorRunner extends WorkerEntrypoint<Env> {
	async runUnit(unit: string): Promise<UnitRun> {
		return runUnit(this.env, unit);
	}
}

const mcpHandler = statelessMcpHandler(createOwnerServer, isAllowedLogin);

// The OAuth resource (token audience) must be an absolute URL. It is derived from the
// request origin, so the same code works on workers.dev, a custom domain and localhost.
const providers = new Map<string, OAuthProvider<Env>>();

function provider(origin: string): OAuthProvider<Env> {
	let p = providers.get(origin);
	if (!p) {
		p = new OAuthProvider<Env>({
			apiRoute: "/mcp",
			// The handler types of agents and the provider differ slightly.
			apiHandler: mcpHandler as any,
			// Hono app as default handler.
			defaultHandler: GitHubHandler as any,
			authorizeEndpoint: "/authorize",
			tokenEndpoint: "/token",
			clientRegistrationEndpoint: "/register",
			clientIdMetadataDocumentEnabled: true,
			resourceMetadata: {
				resource: `${origin}/mcp`,
				authorization_servers: [origin],
			},
		});
		providers.set(origin, p);
	}
	return p;
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);
		// Signed links of collector_item for large stored files (no OAuth: the signature is the access check).
		if (url.pathname === DOWNLOAD_PATH) return handleDownload(request, env);
		return provider(url.origin).fetch(request, env, ctx);
	},

	// Run around the clock; optional quiet-hours policy is currently disabled by the owner.
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		if (isQuietHours()) return;
		ctx.waitUntil(
			runAll(env, `cron ${controller.cron}`).then((runs) =>
				console.log(`collector: ${runs.map((r) => `${r.unit}=${r.state} sub=${r.subrequests} +${r.new} ~${r.changed} -${r.removed} pending=${r.pending}`).join(" ")}`),
			),
		);
	},
} satisfies ExportedHandler<Env>;
