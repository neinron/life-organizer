import assert from "node:assert/strict";
import test from "node:test";
import { renewGoogleWatch } from "../src/http.ts";

class WatchDB {
  constructor(channels) { this.channels=channels; }
  prepare(sql) {
    const db=this; let args=[];
    return {bind(...values){args=values;return this;},async all(){return {results:[...db.channels]};},async run(){
      if(sql.startsWith("DELETE")&&sql.includes("expiration"))db.channels=db.channels.filter(c=>Number(c.expiration)>args[0]);
      else if(sql.startsWith("DELETE"))db.channels=db.channels.filter(c=>c.channel_id!==args[0]);
      else if(sql.includes("INSERT INTO webhook_channels"))db.channels.push({channel_id:args[0],resource_id:args[1],expiration:args[4]});
      return {success:true};
    }};
  }
}
const env=(db)=>({DB:db,NOTION_API_KEY:"n",DATABASE_ID:"d",GOOGLE_CALENDAR_ID:"g",GOOGLE_CLIENT_ID:"c",GOOGLE_CLIENT_SECRET:"s",GOOGLE_REFRESH_TOKEN:"r",SYNC_SECRET:"sync",PUBLIC_BASE_URL:"https://example.test",GOOGLE_WEBHOOK_TOKEN:"test"});

test("44 expired watches are pruned without exhausting remote calls",async()=>{
 const db=new WatchDB(Array.from({length:44},(_,i)=>({channel_id:"old"+i,resource_id:"r",expiration:String(Date.now()-1000)})));
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url)=>{calls.push(String(url));if(String(url).includes("oauth2"))return Response.json({access_token:"test"});if(String(url).endsWith("/events/watch"))return Response.json({id:"new",resourceId:"r",expiration:String(Date.now()+86400000)});throw Error("unexpected request");};
 try {const r=await renewGoogleWatch(env(db));assert.equal(r.status,200);assert.equal(calls.length,2);assert.deepEqual(db.channels.map(c=>c.channel_id),["new"]);}finally{globalThis.fetch=old;}
});

test("failed replacement leaves an existing valid watch active",async()=>{
 const db=new WatchDB([{channel_id:"valid",resource_id:"r",expiration:String(Date.now()+86400000)}]);
 const old=globalThis.fetch;
 globalThis.fetch=async(url)=>String(url).includes("oauth2")?Response.json({access_token:"test"}):Response.json({error:"temporary"},{status:503});
 try {await assert.rejects(renewGoogleWatch(env(db)));assert.deepEqual(db.channels.map(c=>c.channel_id),["valid"]);}finally{globalThis.fetch=old;}
});
