import iphoneScript from './iphone-script.mjs';
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow, noarchive' };
const reply = (data, status=200) => new Response(JSON.stringify(data), {status, headers:HEADERS});
export async function digest(value) {
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
}
async function authorized(request, expected) {
 const header=request.headers.get('Authorization') || '';
 if(!/^[a-f0-9]{64}$/.test(expected||'') || !/^Bearer [A-Za-z0-9_-]{32,128}$/.test(header))return false;
 const actual=await digest(header.slice(7));let diff=0;
 for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^expected.charCodeAt(i);
 return diff===0;
}
function cleanText(value,max) {if(typeof value!=='string'||value.length>max)throw Error('text');return value;}
function id(value){if(value===undefined||value===null)return null;if(typeof value!=='string'||! /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i.test(value))throw Error('id');return value;}
function stamp(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value))||Date.parse(value)>Date.now()+300000)throw Error('date');return value;}
export function sanitize(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('object');
 const array=(key,max)=>{if(!Array.isArray(data[key])||data[key].length>max)throw Error(key);return data[key];};
 return {schema_version:1,snapshot_at:stamp(data.snapshot_at),organizer_at:data.organizer_at?stamp(data.organizer_at):null,
 attention:array('attention',3).map(x=>({id:id(x.id),label:cleanText(x.label,80),text:cleanText(x.text,800)})),
 updates:array('updates',2).map(x=>cleanText(x,800)),
 today:array('today',3).map(x=>({id:id(x.id),title:cleanText(x.title,300),start:x.start?cleanText(x.start,80):null})),
 uploaded_at:new Date().toISOString()};
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(url.pathname==='/widget.js' && request.method==='GET' && !url.search)return new Response(iphoneScript,{headers:{...HEADERS,'Content-Type':'application/javascript; charset=utf-8','Content-Disposition':'attachment; filename=LifeOrganizer.js'}});
 if(url.pathname!=='/summary'||url.search||!['GET','PUT'].includes(request.method))return reply({error:'not_found'},404);
 const expected=request.method==='GET'?env.READ_TOKEN_SHA256:env.WRITE_TOKEN_SHA256;
 if(!await authorized(request,expected))return reply({error:'unauthorized'},401);
 if(request.method==='GET'){
  const saved=await env.BOARD.get('summary');
  return saved?new Response(saved,{headers:HEADERS}):reply({error:'summary_not_available'},503);
 }
 if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))return reply({error:'invalid_content_type'},415);
 const reader=request.body?.getReader();if(!reader)return reply({error:'invalid_payload'},400);
 let size=0,chunks=[];
 try {
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return reply({error:'payload_too_large'},413);}chunks.push(value);}
  const raw=new Uint8Array(size);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}
  const clean=sanitize(JSON.parse(new TextDecoder().decode(raw)));
  await env.BOARD.put('summary',JSON.stringify(clean));
  return reply({ok:true,uploaded_at:clean.uploaded_at});
 }catch{return reply({error:'invalid_payload'},400);}
}};
