#!/usr/bin/env python3
"""Persist complete connector view pages as typed planner input, without any credentials."""
import argparse, hashlib, json, os, uuid
from datetime import datetime, timezone
from pathlib import Path

def page_id(url):
    return str(uuid.UUID(url.split('?')[0].rstrip('/').split('/')[-1]))

def normalize(pages, registrations):
    if not pages or pages[-1].get('has_more') is not False:
        raise ValueError('Incomplete pagination; no usable snapshot')
    seen=set();rows=[]
    for index,page in enumerate(pages):
        if index<len(pages)-1 and (page.get('has_more') is not True or not page.get('next_cursor')):
            raise ValueError('Invalid pagination boundary')
        for row in page['results']:
            uid=page_id(row['url'])
            if uid in seen:raise ValueError('Duplicate page across transport pages')
            seen.add(uid)
            props={}
            def put(name,kind,value):props[name]={'type':kind,kind:value}
            put('Name','title',[{'plain_text':row.get('Name',''),'text':{'content':row.get('Name','')}}])
            put('Codex Logs','rich_text',[{'plain_text':row.get('Codex Logs',''),'text':{'content':row.get('Codex Logs','')}}])
            put('Status','status',{'name':row.get('Status','')})
            for key in ['Type','Priority']:put(key,'select',{'name':row[key]} if row.get(key) else None)
            put('Fixiert','checkbox',row.get('Fixiert')=='__YES__')
            relations=row.get('Course') or []
            if isinstance(relations,str):relations=json.loads(relations)
            ids=[page_id(url) for url in relations]
            put('Course','relation',[{'id':uid} for uid in ids])
            # Never infer a course registration from a rollupResult URL or visibility.
            put('Registration','checkbox',any(registrations.get(uid) is True for uid in ids))
            for key in ['Do Date','Due Date']:
                a=row.get('date:'+key+':start');b=row.get('date:'+key+':end')
                put(key,'date',{'start':a,'end':b} if a else None)
            rows.append({'id':uid,'url':row['url'],'created_time':row.get('Created time') or row.get('createdTime'),'properties':props})
    if not rows:raise ValueError('Empty full source is unexpected; no write')
    return {'results':rows,'has_more':False,'next_cursor':None,'read_mode':'complete connected Notion view; explicit current course registrations','transport_pages':len(pages)}

def persist(data,target,kind='notion_tasks'):
    target=Path(target).resolve();target.parent.mkdir(parents=True,exist_ok=True)
    raw=(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode();tmp=target.with_suffix('.tmp')
    tmp.write_bytes(raw);os.replace(tmp,target)
    manifest={'ok':True,'created_at':datetime.now(timezone.utc).isoformat(),kind:{'kind':kind,'path':str(target),'row_count':len(data['results']),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}}
    m=target.with_name(target.name.replace('-latest.json','-manifest.json'));m.write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--pages',type=Path,required=True);ap.add_argument('--registrations',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    print(json.dumps(persist(normalize(json.loads(a.pages.read_text()),json.loads(a.registrations.read_text())),a.out)))
