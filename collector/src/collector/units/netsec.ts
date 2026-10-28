// Current IN2101 platform: task-list metadata only. Never fetch task detail, files or submissions.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CookieJar, jarFetch } from "../../lib/http";
import { parseTables } from "../../lib/html-table";
import { storeGet, storePut, storeDelete } from "../../lib/store";
import { tumSsoLogin } from "../../lib/tum-sso";
import { LoginError, json, run } from "../../lib/tools";
import { item, type UnitCtx } from "../unit";

const ORIGIN = "https://netsec.net.in.tum.de";
const SESSION = "netsec-metadata-session";
export interface ChallengeMeta { id: string; title: string; url: string; due_display: string; own_submission_status: string; grading_status: string }
export function parseChallengeMetadata(html: string): ChallengeMeta[] {
 const table = parseTables(html).find(t => t.headers.some(h => /Your submission/i.test(h)) && t.headers.some(h => /^Due$/i.test(h)));
 if (!/signed in as/i.test(html) || !table) throw new LoginError("Netsec task list is not an authenticated, recognized listing");
 return table.rows.flatMap((row, index) => {
  if (!/^pwn\d+_\d+$/.test(row[0] ?? "")) return [];
  if (row.length !== 5 || !/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(row[2])) throw new Error("Netsec task-list format changed; keep previous metadata");
  const raw = /href=["']([^"']*\/tasks\/\d+)["']/.exec(table.rowHtml[index])?.[1];
  if (!raw) throw new Error("Netsec task URL missing");
  const url = new URL(raw, ORIGIN);
  if (url.origin !== ORIGIN || !/^\/tasks\/\d+$/.test(url.pathname) || url.search || url.hash) throw new Error("Unexpected Netsec task URL");
  return [{ id: row[0], title: row[1], url: url.href, due_display: row[2], own_submission_status: row[3], grading_status: row[4] }];
 });
}
export async function readChallengeMetadata(env: Env): Promise<ChallengeMeta[]> {
 for (let attempt = 0; attempt < 2; attempt++) {
  const saved = attempt === 0 ? await storeGet<ReturnType<CookieJar["toJSON"]>>(env, SESSION) : undefined;
  const jar = new CookieJar(saved);
  let page;
  if (saved) page = await jarFetch(jar, `${ORIGIN}/tasks/`);
  else page = await tumSsoLogin(env, jar, `${ORIGIN}/login`);
  if (page.url.origin === ORIGIN && /signed in as/i.test(page.text)) {
   if (!/^\/tasks\/?$/.test(page.url.pathname)) page = await jarFetch(jar, `${ORIGIN}/tasks/`);
   const data = parseChallengeMetadata(page.text);
   await storePut(env, SESSION, jar.toJSON(), 3600);
   return data;
  }
  await storeDelete(env, SESSION);
 }
 throw new LoginError("Netsec metadata session could not be restored; browser fallback required");
}
export async function unitNetsec(ctx: UnitCtx): Promise<void> {
 const tasks = await readChallengeMetadata(ctx.env);
 await ctx.apply({ scope: "netsec:challenges", complete: true, entries: tasks.map(t => ({key:`netsec:challenge:${t.id}`,item:item("sites",`netsec:challenge:${t.id}`,t.title,t.url,{...t,metadata_only:true})})) });
}
export function registerNetsecMetadataTools(server: McpServer, env: Env): void {
 server.registerTool("netsec_challenges", {description:"Read only current IN2101 task-list IDs, names, deadlines and own submission status. No detail pages, files, code or solutions.",inputSchema:{},annotations:{readOnlyHint:true}},async()=>run(async()=>json({tasks:await readChallengeMetadata(env),metadata_only:true})));
}
