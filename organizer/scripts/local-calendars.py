#!/usr/bin/env python3
"""Merge a fresh explicit-allowlist native calendar snapshot into Google availability."""
import argparse,copy,hashlib,json,os,subprocess
from datetime import datetime,timezone,timedelta
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def dt(s):return datetime.fromisoformat(s.replace('Z','+00:00'))
def merge_native(freebusy,native,ids,now=None):
    if not native.get('ok') or not native.get('complete'):raise ValueError('Native calendar read incomplete')
    if set(ids)!={c['id'] for c in native['calendars']}:raise ValueError('Native calendar allowlist mismatch')
    if dt(native['timeMin'])>dt(freebusy['timeMin']) or dt(native['timeMax'])<dt(freebusy['timeMax']):raise ValueError('Native snapshot does not cover planning window')
    if (now or datetime.now(timezone.utc))-dt(native['checked_at'])>timedelta(minutes=15):raise ValueError('Native snapshot stale; refresh before planning')
    out=copy.deepcopy(freebusy)
    for cid in ids:
        out['calendars']['apple:'+cid]={'busy':[{'start':e['start'],'end':e['end']} for e in native['events'] if e['calendar_id']==cid and e['busy'] and dt(e['end'])>dt(freebusy['timeMin']) and dt(e['start'])<dt(freebusy['timeMax'])]}
    out['native_calendar_checked_at']=native['checked_at']
    return out
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--freebusy',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    policy=json.loads((ROOT/'profile.json').read_text()).get('local_calendars',{});ids=policy.get('calendar_ids',[])
    if not policy.get('enabled') or not ids:raise SystemExit('Native calendars not configured; do not claim Exchange checked')
    fb=json.loads(a.freebusy.read_text())
    cmd=[str(ROOT/'runtime/bin/apple-store'),'events','--start',fb['timeMin'],'--end',fb['timeMax'],'--calendar-ids',','.join(ids)]
    r=subprocess.run(cmd,capture_output=True,text=True,timeout=45)
    if r.returncode:raise SystemExit(r.stdout or r.stderr)
    native=json.loads(r.stdout);merged=merge_native(fb,native,ids)
    raw=(json.dumps(merged,ensure_ascii=False,indent=2)+'\n').encode();tmp=a.out.with_suffix('.tmp');tmp.write_bytes(raw);os.replace(tmp,a.out)
    target=a.out.resolve();manifest={'ok':True,'created_at':datetime.now(timezone.utc).isoformat(),'google_freebusy':{'kind':'google_freebusy','path':str(target),'row_count':len(merged['calendars']),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}}
    target.with_name('freebusy-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    a.out.with_name('apple-events.json').write_text(json.dumps(native,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'ok':True,'calendars':len(ids),'events':len(native['events']),'out':str(a.out)}))
