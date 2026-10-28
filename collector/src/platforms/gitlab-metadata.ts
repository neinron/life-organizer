import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {json,run,NotConfiguredError} from '../lib/tools';
const projects=['isdo.ase26/ase26_exercise_0','isdo.ase26/ase26_exercise_1'];
export async function gitlabHeads(env:Env){
 const token=(env as Env & {GITLAB_READ_TOKEN?:string}).GITLAB_READ_TOKEN?.trim();
 if(!token)throw new NotConfiguredError('GitLab read-only metadata',['GITLAB_READ_TOKEN (read_repository only)']);
 const rows=[];
 for(const project of projects){
  const response=await fetch(`https://gitlab.lrz.de/api/v4/projects/${encodeURIComponent(project)}/repository/branches/main`,{headers:{'PRIVATE-TOKEN':token,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error(`GitLab read-only metadata HTTP${response.status}; previous checkpoint retained`);}
  const data=await response.json() as {commit?:{id?:string;title?:string;web_url?:string;committed_date?:string}};
  if(!/^[a-f0-9]{40}$/.test(data.commit?.id??''))throw new Error('Invalid GitLab commit response');
  rows.push({project,branch:'main',sha:data.commit!.id,title:data.commit!.title,url:data.commit!.web_url,committed_at:data.commit!.committed_date});
 }
 return {complete:true,checked_at:new Date().toISOString(),repositories:rows};
}
export function registerGitlabMetadataTools(server:McpServer,env:Env){
 server.registerTool('gitlab_repository_heads',{description:'Read only main commit metadata of the two configured ASE teaching repositories. Needs GITLAB_READ_TOKEN with read_repository scope. No forks, files, pipelines or writes.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>run(async()=>json(await gitlabHeads(env))));
}
