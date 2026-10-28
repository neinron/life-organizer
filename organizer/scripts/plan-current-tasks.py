#!/usr/bin/env python3
"""Plan only missing work dates for current Watcher tasks from verified snapshots."""
import argparse, json, sys
from pathlib import Path
from datetime import datetime, timedelta, time
from planning_scope import in_scope, is_fixed
from calendar_policy import require_local_calendars

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'lib'))
import planning_engine as p

root=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--snapshot-dir',type=Path,required=True);ap.add_argument('--now',required=True);ap.add_argument('--out-prefix',default='plan-current');a=ap.parse_args()
d=a.snapshot_dir.resolve();profile=json.loads((root/'profile.json').read_text());policy=profile['planning']
p.WORK_START=time.fromisoformat(policy.get('work_start','08:30'))
p.validate_snapshot_manifest(d/'notion-manifest.json',d/'notion-latest.json','notion_tasks')
p.validate_snapshot_manifest(d/'freebusy-manifest.json',d/'freebusy-latest.json','google_freebusy')
data=json.loads((d/'notion-latest.json').read_text());fb=json.loads((d/'freebusy-latest.json').read_text());tasks=p.extract_tasks(data);busy=p.extract_busy(fb);busy += [p.Interval(p.parse_dt(e['start']),p.parse_dt(e['end']),'external') for e in policy.get('external_commitments',[])];now=p.parse_dt(a.now)
assert now and policy['enabled']
require_local_calendars(fb,profile,now)
assert p.parse_dt(fb['timeMin']) <= now < p.parse_dt(fb['timeMax'])
active={c['notion_id'] for c in profile['courses'] if c.get('plan_work', True)};general=set(policy['general_task_ids']);deferred=policy['deferred_task_ids'];candidates=[];retained=[]
for task in tasks:
 if task.status not in {'not started','in progress'}:continue
 rels=task.raw.get('properties',{}).get('Course',{}).get('relation',[])
 scoped=in_scope(task,profile)
 if scoped and task.id not in deferred and task.do_start is None and not is_fixed(task):candidates.append(task)
 elif p.task_interval(task) and task.do_end > now:retained.append(task)
fixed=list(busy)
for task in retained:fixed.append(p.Interval(task.do_start,task.do_end+timedelta(minutes=15),'retained:'+task.id))
busy=p.merge(fixed)
# Order organization first, then source prerequisites. Never change the stored task name/type.
ordered=['8157-ba60-dfa5afab56eb','819b-a8d7-c6f52c55c755','81c1-b94c-d074cb3040d0','817b-9e64-f52e35211f7f','81a3-bbb6-deec76acddbe','81a2-9da5-edcb727c581a','8140-9ea4-ee2814d33ad3','81d2-bb03-f25984930a99','8119-8fcb-e79e38f65f64','8197-9280-edd4b28c5c3d','8157-a5f8-fecd6169c4cc','814a-b9fd-ce2b78e0b52c','813f-9b29-e1a1dd0026b5','8114-ad7c-e8cf5c7afd06','81eb-8af2-df1e20923b58','8142-8c2f-da03c2b0c7c2','8176-9758-c654aac60877','81fb-8b16-c64e52d6d729','81cf-8ebd-ea5dbcf0c949','8139-ac65-db3e94758a8a']
ordered=policy.get('task_order',[])+ordered
def order(t):
 return t.due_start or datetime.max.replace(tzinfo=p.TZ),next((i for i,s in enumerate(ordered) if t.id.endswith(s)),len(ordered)),p.natural_key(t.name),t.id
candidates.sort(key=order);daily={};moves=[];unplaced=[];sequence_cursor={}
for task in retained:
 rels=task.raw.get('properties',{}).get('Course',{}).get('relation',[])
 if in_scope(task,profile):
  day=task.do_start.astimezone(p.TZ).date().isoformat()
  daily[day]=daily.get(day,0)+int((task.do_end-task.do_start).total_seconds()/60)
for task in candidates:
 cursor=max(now,p.parse_dt(policy['earliest_start'].get(task.id)) or now)
 sequence_key=task.course if task.id in policy.get('task_order',[]) else None
 if sequence_key is not None:cursor=max(cursor,sequence_cursor.get(sequence_key,now))
 horizon=now+timedelta(days=7)
 if cursor>horizon:horizon=min(now+timedelta(days=28),p.parse_dt(fb['timeMax']))
 if task.due_start:horizon=min(horizon,task.due_start)
 max_horizon=min(now+timedelta(days=28),p.parse_dt(fb['timeMax']))
 if task.due_start:max_horizon=min(max_horizon,task.due_start)
 estimate=policy.get('task_durations',{}).get(task.id)
 if not estimate:
  unplaced.append({'id':task.id,'reason':'Task-specific duration evidence or estimate required'});continue
 dur=timedelta(minutes=estimate['minutes']);slot=None
 while cursor<max_horizon:
  slot=p.place_task(cursor,dur,busy,horizon)
  if not slot:
   if horizon<max_horizon:
    horizon=min(horizon+timedelta(days=7),max_horizon);continue
   break
  start,end=slot;day=start.date().isoformat()
  if daily.get(day,0)+int(dur.total_seconds()/60)<=policy['daily_work_minutes']:break
  cursor=datetime.combine(start.date()+timedelta(days=1),p.WORK_START,p.TZ);slot=None
 if not slot:unplaced.append({'id':task.id,'reason':'No free slot before deadline or in verified horizon'});continue
 start,end=slot;daily[day]=daily.get(day,0)+int(dur.total_seconds()/60)
 reason='initial current-semester plan; checked 7 selected calendars; prerequisites; 15-minute buffer'
 if task.id in policy['earliest_start']:reason+='; official registration opens16Nov'
 line=f'{now:%Y-%m-%d %H:%M}: moved Do Date from empty -> {start.isoformat()} - {end.isoformat()} (reason: {reason})'
 move={'id':task.id,'url':task.url,'name':task.name,'old_start':'','old_end':'','new_start':start.isoformat(),'new_end':end.isoformat(),'reason':reason,'properties':{'date:Do Date:start':start.isoformat(),'date:Do Date:end':end.isoformat(),'date:Do Date:is_datetime':1},'codex_log_line':line,'expected_status':task.status}
 moves.append(move);busy=p.merge(busy+[p.Interval(start,end+timedelta(minutes=15),'move:'+task.id)])
 if sequence_key is not None:sequence_cursor[sequence_key]=end+timedelta(minutes=15)
errors=p.validate_plan(moves,retained,p.extract_busy(fb),now)
result={'ok':not errors and not unplaced,'created_at':now.isoformat(),'moves':moves,'deferred':deferred,'retained_count':len(retained),'unplaced':unplaced,'validation_errors':errors,'daily_work_minutes':daily,'notion_count':len(tasks),'calendar_count':len(fb['calendars'])}
(d/(a.out_prefix+'.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');p.write_csv(d/(a.out_prefix+'.csv'),result)
print(json.dumps({k:v for k,v in result.items() if k!='moves'},ensure_ascii=False));print(json.dumps([{k:m[k] for k in ['id','name','new_start','new_end']} for m in moves],ensure_ascii=False))
if not result['ok']:raise SystemExit(2)
