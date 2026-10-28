// Read MP4 movie-header duration through bounded HTTP byte ranges, never the video payload.
export type RangeReader = (offset: number, length: number) => Promise<{ bytes: Uint8Array; total: number }>;
export function boundedMediaReader(fetchRange:(offset:number,length:number)=>Promise<Response>) {
 let transferred=0,prefix:Uint8Array|undefined,total=0;
 const budget=262144;
 return {transferred:()=>transferred,read:async(offset:number,length:number)=>{
  if(prefix&&offset+length<=prefix.length)return {bytes:prefix.slice(offset,offset+length),total};
  const response=await fetchRange(offset,length);
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')??'');
  const ranged=response.status===206&&range&&Number(range[1])===offset;
  const prefixMode=response.status===200&&/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type')??'')&&offset+length<=budget;
  if(!ranged&&!prefixMode){await response.body?.cancel();throw new Error(`Bounded MP4 metadata unavailable (HTTP${response.status}); no full video download`);}
  total=ranged?Number(range[3]):Number(response.headers.get('content-length'));
  if(!Number.isSafeInteger(total)||total<8){await response.body?.cancel();throw new Error('Missing MP4 content length');}
  const needed=ranged?Math.min(length,total-offset):Math.min(offset+length,total);
  const reader=response.body?.getReader();if(!reader)throw new Error('Missing MP4 stream');
  const chunks:Uint8Array[]=[];let size=0;
  try{
   while(size<needed){const r=await reader.read();if(r.done)break;transferred+=r.value.length;size+=r.value.length;if(transferred>budget)throw new Error('MP4 metadata byte budget exceeded');chunks.push(r.value);}
  }finally{await reader.cancel();}
  if(size<needed)throw new Error('Truncated MP4 metadata');
  const bytes=new Uint8Array(size);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}
  if(prefixMode){prefix=bytes;return {bytes:bytes.slice(offset,offset+length),total};}
  return {bytes:bytes.slice(0,length),total};
 }};
}
export async function mp4Duration(read: RangeReader): Promise<number> {
 let loads=0;
 async function box(offset:number) {
  if (++loads>24) throw new Error('MP4 metadata request budget exceeded');
  const {bytes,total}=await read(offset,64);
  if(bytes.length<8)throw new Error('Truncated MP4 box');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let size=view.getUint32(0),header=8;
  if(size===1){if(bytes.length<16)throw new Error('Truncated extended box');const big=view.getBigUint64(8);if(big>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('MP4 size overflow');size=Number(big);header=16;}
  if(size===0)size=total-offset;
  if(size<header||offset+size>total)throw new Error('Invalid MP4 box boundary');
  return {type:new TextDecoder().decode(bytes.slice(4,8)),size,header,view,total,bytes};
 }
 let offset=0;
 for(let i=0;i<16;i++) {
  const outer=await box(offset);
  if(outer.type==='moov') {
   let child=offset+outer.header;const end=offset+outer.size;
   while(child<end){
    const b=await box(child);
    if(child+b.size>end)throw new Error('MP4 child outside movie box');
    if(b.type==='mvhd') {
     const version=b.bytes[b.header];if(version!==0&&version!==1)throw new Error('Unsupported movie-header version');
     const scaleAt=b.header+(version===0?12:20),durationAt=scaleAt+4;
     if(b.bytes.length<durationAt+(version===0?4:8))throw new Error('Truncated movie header');
     const scale=b.view.getUint32(scaleAt),ticks=version===0?b.view.getUint32(durationAt):Number(b.view.getBigUint64(durationAt));
     const seconds=ticks/scale;
     if(!scale||!Number.isFinite(seconds)||seconds<=0||seconds>86400)throw new Error('Invalid movie duration');
     return seconds;
    }
    child+=b.size;
   }
   throw new Error('Movie duration header not found');
  }
  offset+=outer.size;if(offset>=outer.total)break;
 }
 throw new Error('Movie box not found within metadata budget');
}
