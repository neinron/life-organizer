import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { storedItem } from '../collector/store';
import { json,run } from '../lib/tools';
import { mp4Duration,boundedMediaReader } from '../lib/mp4-metadata';
import { MoodleClient } from './moodle';

export async function videoMetadata(env:Env,cmid:number) {
 const stored=await storedItem(env,`moodle:cm:${cmid}`);
 const content=stored?.content as any;
 // Only organizational ASE lecture videos; never challenge or arbitrary supplied URLs.
 if(content?.course_id!==121285)throw new Error('Metadata is limited to collected ASE lecture activities');
 const urls=[...new Set<string>((content.page?.embedded_media??[]).map((x:any)=>x.url))].filter(raw=>{
  const u=new URL(raw);return u.origin==='https://www.moodle.tum.de'&&u.pathname.startsWith('/pluginfile.php/')&&u.pathname.endsWith('.mp4')&&!u.search;
 });
 if(!urls.length||urls.length>2)throw new Error('Expected one or two collected official MP4 lecture URLs');
 const client=MoodleClient.create(env);await client.web('/my/');
 const videos=[];
 for(const url of urls){
  const reader=boundedMediaReader((offset,length)=>client.rawFetch(url,'manual',{Range:`bytes=${offset}-${offset+length-1}`}));
  const seconds=await mp4Duration(reader.read);
  videos.push({url,seconds,planning_minutes:Math.ceil(seconds/300)*5,metadata_bytes:reader.transferred()});
 }
 return {cmid,videos,verified_at:new Date().toISOString(),method:'MP4 mvhd via64-byte ranges or bounded prefix, maximum256KiB; no playback or full video download'};
}
export function registerMoodleMediaTools(server:McpServer,env:Env){
 server.registerTool('moodle_video_metadata',{description:'Measured duration of collected ASE lecture MP4 files using bounded movie-header ranges, no browser or video download. No arbitrary URLs or challenge files.',inputSchema:{cmid:z.number().int().positive()},annotations:{readOnlyHint:true}},async({cmid})=>run(async()=>json(await videoMetadata(env,cmid))));
}
