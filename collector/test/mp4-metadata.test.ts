import {describe,it,expect} from 'vitest';
import {mp4Duration,boundedMediaReader} from '../src/lib/mp4-metadata';
function box(type:string,payload:Uint8Array){const b=new Uint8Array(payload.length+8);new DataView(b.buffer).setUint32(0,b.length);b.set(new TextEncoder().encode(type),4);b.set(payload,8);return b;}
function join(...xs:Uint8Array[]){const b=new Uint8Array(xs.reduce((n,x)=>n+x.length,0));let o=0;for(const x of xs){b.set(x,o);o+=x.length;}return b;}
function movie(version=0,scale=1000){const b=new Uint8Array(version===0?100:112);b[0]=version;const d=new DataView(b.buffer);d.setUint32(version===0?12:20,scale);if(version===0)d.setUint32(16,1149190);else d.setBigUint64(24,1149190n);return box('moov',box('mvhd',b));}
function reader(bytes:Uint8Array){return async(offset:number,length:number)=>({bytes:bytes.slice(offset,offset+length),total:bytes.length});}
describe('bounded MP4 metadata',()=>{
 it('measures version0 movie header',async()=>expect(await mp4Duration(reader(join(box('ftyp',new Uint8Array(8)),movie())))).toBe(1149.19));
 it('measures64bit version1 duration',async()=>expect(await mp4Duration(reader(movie(1)))).toBe(1149.19));
 it('skips media payload by box size without reading it',async()=>{const bytes=join(box('ftyp',new Uint8Array(8)),box('mdat',new Uint8Array(100000)),movie());const reads:number[]=[];await mp4Duration(async(o,n)=>{reads.push(o);return reader(bytes)(o,n);});expect(reads.length).toBeLessThan(6);expect(reads).not.toContain(1000);});
 it('rejectszero timescale',async()=>await expect(mp4Duration(reader(movie(0,0)))).rejects.toThrow('Invalid movie duration'));
 it('rejects malformed boundary',async()=>await expect(mp4Duration(reader(new Uint8Array(64)))).rejects.toThrow());
 it('rejects missing movie instead of inventing duration',async()=>await expect(mp4Duration(reader(box('mdat',new Uint8Array(100))))).rejects.toThrow('Movie box not found'));
 it('handles servers ignoring Range using a bounded MP4 prefix',async()=>{const bytes=join(movie(),box('mdat',new Uint8Array(1000)));let calls=0;const r=boundedMediaReader(async()=>{calls++;return new Response(bytes,{headers:{'content-type':'video/mp4','content-length':String(bytes.length)}});});expect(await mp4Duration(r.read)).toBe(1149.19);expect(calls).toBe(1);});
 it('rejects HTML/login rather than treating it as a video',async()=>{const r=boundedMediaReader(async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}));await expect(r.read(0,64)).rejects.toThrow('Bounded MP4 metadata unavailable');});
 it('stops oversized prefix chunks',async()=>{const r=boundedMediaReader(async()=>new Response(new Uint8Array(300000),{headers:{'content-type':'video/mp4','content-length':'300000'}}));await expect(r.read(0,64)).rejects.toThrow('byte budget');});
});
