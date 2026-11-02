import {test} from 'node:test';import assert from 'node:assert/strict';import code from './iphone-script.mjs';
const sample={attention:[{id:'11111111-1111-4111-8111-111111111111',label:'Entscheidung nötig',text:'Review the proposal and choose the next step.'}],today:[],updates:[],snapshot_at:new Date().toISOString()};
class Element{constructor(){this.children=[];}addText(value){const t={value,centerAlignText(){}};this.children.push(t);return t;}addImage(value){const i={image:value};this.children.push(i);return i;}addStack(){const s=new Element();this.children.push(s);return s;}addSpacer(){}setPadding(){}layoutVertically(){}layoutHorizontally(){}topAlignContent(){}}
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const family of ['accessoryInline','accessoryCircular','accessoryRectangular','large'])test('renders '+family+' with a task link',async()=>{
 let widget;const fm={documentsDirectory:()=>'/test',joinPath:(a,b)=>a+'/'+b,writeString(){},readString:()=>JSON.stringify(sample)};
 class Request{response={statusCode:200};async loadJSON(){return sample;}}
 class Color{constructor(){}static dynamic(){return {};}static white(){return {};}}
 const Font={systemFont:()=>({}),semiboldSystemFont:()=>({})};
 const Script={setWidget(w){widget=w;},complete(){}};
 const DateFormatter=class{string(){return '02.11.';}};
 await new AsyncFunction('FileManager','Keychain','config','Request','ListWidget','Color','Font','Script','DateFormatter','SFSymbol','Size',code)(
 {local:()=>fm},{contains:()=>true,get:()=> 'r'.repeat(43)},{runsInWidget:true,widgetFamily:family},Request,Element,Color,Font,Script,DateFormatter,{named:()=>({image:{}})},class{});
 assert.match(widget.url,/^notion:\/\//);
 if(family==='accessoryInline')assert.equal(widget.children.filter(x=>x.value).length,1);
 if(family==='accessoryCircular')assert.equal(widget.children[0].value,'1');
});
