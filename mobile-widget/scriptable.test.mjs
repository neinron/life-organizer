import {test} from 'node:test';import assert from 'node:assert/strict';import code from './iphone-script.mjs';
const sample={attention:[{id:'11111111-1111-4111-8111-111111111111',label:'Entscheidung nötig',text:'Review the proposal and choose the next step.'}],today:[],updates:[],snapshot_at:new Date().toISOString()};
sample.sections=[{title:'Review',items:[{label:'Review',text:'Review the proposal.',severity:'warning',action:{url:'notion://www.notion.so/11111111111141118111111111111111'}}]}];
class Element{constructor(){this.children=[];}addText(value){const t={value,centerAlignText(){},leftAlignText(){}};this.children.push(t);return t;}addImage(value){const i={image:value,leftAlignImage(){},applyFittingContentMode(){}};this.children.push(i);return i;}addStack(){const s=new Element();this.children.push(s);return s;}addSpacer(){}setPadding(){}layoutVertically(){}layoutHorizontally(){}topAlignContent(){}centerAlignContent(){}}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const family of ['accessoryInline','accessoryCircular','accessoryRectangular','large'])test('renders '+family+' with a task link',async()=>{
 let widget;const fm={documentsDirectory:()=>'/test',joinPath:(a,b)=>a+'/'+b,writeString(){},readString:()=>JSON.stringify(sample)};
 class Request{response={statusCode:200};async loadJSON(){return sample;}}
 class Color{constructor(){}static dynamic(){return {};}static white(){return {};}}
 const Font={systemFont:()=>({}),semiboldSystemFont:()=>({})};
 const Script={setWidget(w){widget=w;},complete(){}};
 const DateFormatter=class{string(){return '02.11.';}};
 await new AsyncFunction('FileManager','Keychain','config','Request','ListWidget','Color','Font','Script','DateFormatter','SFSymbol','Size','Device','DrawContext','Rect','WebView',code)(
 {local:()=>fm},{contains:()=>true,get:()=> 'r'.repeat(43)},{runsInWidget:true,widgetFamily:family},Request,Element,Color,Font,Script,DateFormatter,{named:()=>({image:{}})},class{}, {screenSize:()=>({width:390,height:844})}, class{setFont(){}setTextAlignedLeft(){}setTextColor(){}drawTextInRect(){}getImage(){return {}; }}, class{}, class{async loadHTML(){}async evaluateJavaScript(source){const document={createElement:()=>({getContext:()=>({measureText:t=>({width:t.length*6.5})})})};return eval(source);}});
 assert.match(widget.url,/^notion:\/\//);
 if(family==='accessoryInline')assert.equal(widget.children.filter(x=>x.value).length,1);
 if(family==='accessoryCircular')assert.equal(widget.children[0].value,'1');
});

const calendarAction={url:'calshow:815483700',calendar:{title:'Verified event',calendar_title:'Studium',start:'2026-11-02T12:15:00Z',end:'2026-11-02T15:30:00Z'}};
const nativeHelper=code.slice(code.indexOf('// Resolve native IDs'),code.indexOf('const w = new ListWidget();'));
async function resolveNative(calendars,events,action=calendarAction){
 const d={sections:[{surfaces:['mobile'],items:[{action}]}]};
 return new AsyncFunction('d','Calendar','CalendarEvent',nativeHelper+'return nativeAction(d.sections[0].items[0].action);')(d,{forEvents:calendars},{between:events});
}
const localCalendar={title:'Studium',identifier:'22222222-2222-4222-8222-222222222222'};
const localEvent={title:'Verified event',startDate:new Date(calendarAction.calendar.start),endDate:new Date(calendarAction.calendar.end),calendar:localCalendar,identifier:'33333333-3333-4333-8333-333333333333'};
test('iPhone event links use this device IDs and only the matched calendar',async()=>{
 let seen;
 const url=await resolveNative(async()=>[localCalendar,{title:'Unrelated'}],async(start,end,selected)=>{seen=selected;return [localEvent];});
 assert.deepEqual(seen,[localCalendar]);
 assert.equal(url,'x-apple-calevent://'+localCalendar.identifier+'/'+localEvent.identifier);
});
test('missing permission, ambiguous events and missing sync fall back to Calendar date',async()=>{
 assert.equal(await resolveNative(async()=>{throw Error('permission');},async()=>{throw Error('must not query');}),calendarAction.url);
 for(const events of [[],[localEvent,localEvent],[{...localEvent,title:'Other'}]])assert.equal(await resolveNative(async()=>[localCalendar],async()=>events),calendarAction.url);
 assert.equal(await resolveNative(async()=>[],async()=>{throw Error('must not query');}),calendarAction.url);
});
test('calendar link resolver rejects executable and Google web targets',async()=>{
 for(const url of ['javascript:alert(1)','https://calendar.google.com/calendar/event?eid=test','calshow:1\n'])assert.equal(await resolveNative(async()=>[],async()=>[],{url}),null);
});
