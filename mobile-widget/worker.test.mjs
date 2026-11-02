import {test} from 'node:test';import assert from 'node:assert/strict';
import worker,{digest} from './worker.mjs';
const read='r'.repeat(43),write='w'.repeat(43);let saved=null;
const env={READ_TOKEN_SHA256:await digest(read),WRITE_TOKEN_SHA256:await digest(write),BOARD:{get:async()=>saved,put:async(k,v)=>saved=v}};
const req=(method,token,body)=>new Request('https://organizer.example.com/summary',{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body && method!=='GET'?{body:JSON.stringify(body)}:{})});
const data={snapshot_at:new Date().toISOString(),attention:[{label:'Review',text:'Check the proposal.',id:null}],updates:[],today:[],private_field:'must not leak'};
test('unauthenticated and wrong-key requests cannot read or write',async()=>{for(const [m,k]of [['GET',null],['GET',write],['PUT',read],['PUT','bad']])assert.equal((await worker.fetch(req(m,k,data),env)).status,401);assert.equal(saved,null);});
test('authorized write stores only allowlisted fields and authorized read returns no-store',async()=>{assert.equal((await worker.fetch(req('PUT',write,data),env)).status,200);const r=await worker.fetch(req('GET',read),env);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.equal((await r.json()).private_field,undefined);});
test('malformed and oversized input cannot replace the last good summary',async()=>{const before=saved;assert.equal((await worker.fetch(req('PUT',write,{...data,attention:[{...data.attention[0],id:"';evil"}]}),env)).status,400);assert.equal((await worker.fetch(req('PUT',write,{...data,private_field:'x'.repeat(40000)}),env)).status,413);assert.equal(saved,before);});
test('keys in URLs and unrelated paths are rejected',async()=>{assert.equal((await worker.fetch(new Request('https://organizer.example.com/summary?key=secret'),env)).status,404);assert.equal((await worker.fetch(new Request('https://organizer.example.com/'),env)).status,404);});
test('adaptive sections accept safe native and existing-mail actions and reject executable links',async()=>{
 const board={...data,board_at:new Date().toISOString(),sections:[{title:'Antworten',items:[{label:'Entwurf prüfen',text:'Review your email draft.',action:{url:'https://mail.google.com/mail/u/0/#drafts/verified-existing-draft'}}]}]};
 assert.equal((await worker.fetch(req('PUT',write,board),env)).status,200);
 assert.equal(JSON.parse(saved).sections[0].items[0].action.url,'https://mail.google.com/mail/u/0/#drafts/verified-existing-draft');
 board.sections[0].items[0].action.url='javascript:alert(1)';
 assert.equal((await worker.fetch(req('PUT',write,board),env)).status,400);
});

test('native calendar actions retain device-specific links and reject web/executable alternatives',async()=>{
 const action={url:'calshow:815483700',desktop_url:'ical://ekevent/20261102T121500Z/11111111-1111-4111-8111-111111111111?method=show&options=more',calendar:{title:'Verified event',calendar_title:'Studium',start:'2026-11-02T12:15:00Z',end:'2026-11-02T15:30:00Z'}};
 const board={...data,sections:[{title:'Next',items:[{text:'Open existing event',action}]}]};
 assert.equal((await worker.fetch(req('PUT',write,board),env)).status,200);
 assert.deepEqual(JSON.parse(saved).sections[0].items[0].action,action);
 const before=saved;
 for(const changed of [{url:'https://calendar.google.com/calendar/event?eid=test'},{url:'calshow:bad'},{desktop_url:'javascript:alert(1)'},{desktop_url:action.desktop_url+'\n'},{calendar:{...action.calendar,end:action.calendar.start}},{calendar:{...action.calendar,start:'bad'}}]){
  board.sections[0].items[0].action={...action,...changed};
  assert.equal((await worker.fetch(req('PUT',write,board),env)).status,400);
  assert.equal(saved,before);
 }
});
