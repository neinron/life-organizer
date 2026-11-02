#!/usr/bin/env python3
"""Reflow current not-started tasks after missed work; preserve deadline blocks and user status."""
import argparse, copy, json, re, sys
from datetime import datetime, timedelta, time
from pathlib import Path
from planning_scope import in_scope, is_fixed
from calendar_policy import require_local_calendars

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'lib'))
import planning_engine as p

ROOT = Path(__file__).resolve().parents[1]
TASK_CAL = 'notion_tasks'

def event_interval(e):
    return p.parse_dt(e.get('start', {}).get('dateTime') or e.get('start', {}).get('date')), p.parse_dt(e.get('end', {}).get('dateTime') or e.get('end', {}).get('date'))

def recorded_lecture_slot(course, event):
    """Only a source-backed replacement option can release a live class slot."""
    policy = course.get('attendance', {})
    start, _ = event_interval(event)
    if not start:
        return False
    day = start.astimezone(p.TZ).date().isoformat()
    if day in policy.get('protected_dates', []):
        return False
    text = event.get('summary', '') + ' ' + event.get('description', '')
    if re.search(r'\b(?:guest|gastvortrag|gastvorlesung|fragestunde|tutorial|exercises?|übungen?|presentations?|präsentationen?|exams?|prüfungen?|klausur)\b', text, re.I):
        return False
    # An absent upload is not evidence of a recording policy. Unknown stays busy.
    return any(rule.get('recording') in ('asynchronous_video', 'hybrid_recorded')
               and rule.get('source')
               and start.astimezone(p.TZ).weekday() in rule.get('weekdays', [])
               for rule in policy.get('rules', []))

def reusable_timeline(task, fb, details, profile):
    result=copy.deepcopy(fb);policy=profile['planning']
    if not policy.get('reusable_work_blocks',{}).get('enabled'):return result
    rels={r['id'] for r in task.raw['properties'].get('Course',{}).get('relation',[])}
    course=next((c for c in profile['courses'] if c['notion_id'] in rels and c.get('plan_work')),None)
    lo,hi=p.parse_dt(fb['timeMin']),p.parse_dt(fb['timeMax'])
    for cid,page in details.items():
        if cid not in fb['calendars'] or page.get('nextPageToken'):continue
        rows=[e for e in page.get('items',[]) if e.get('status')!='cancelled' and e.get('transparency')!='transparent']
        parsed=[]
        for e in rows:
            a,b=event_interval(e)
            if a and b and b>lo and a<hi:parsed.append((e,max(a,lo),min(b,hi)))
        # Only replace a timeline when the complete event inventory proves every busy interval.
        observed=p.merge([p.Interval(a,b,'event') for _,a,b in parsed])
        source=p.extract_busy({'calendars':{cid:fb['calendars'][cid]}})
        if [(x.start,x.end) for x in observed]!=[(x.start,x.end) for x in source]:continue
        replacement=[]
        for e,a,b in parsed:
            imported=cid==profile.get('calendars',{}).get('tum_import')
            lecture=bool(course and task.type.lower()=='lecture' and imported and course['name'].lower() in e.get('summary','').lower() and re.search(r'\b(?:VO|VI)\b',e.get('summary','')) and recorded_lecture_slot(course,e))
            approved=any(x['calendar_id']==cid and x['event_id']==e['id'] and (task.id in x.get('task_ids',[]) or rels & set(x.get('context_ids',[]))) for x in policy.get('verified_reusable_blocks',[]))
            # General reuse requires an explicitly verified own-work block, never an appointment.
            if approved and (e.get('attendees') or e.get('eventType','default')!='default'):approved=False
            if imported and not lecture:approved=False
            if not (lecture or approved):replacement.append({'start':a.isoformat(),'end':b.isoformat()})
        result['calendars'][cid]['busy']=replacement
    return result

def plan(data, fb, events, profile, now, calendar_details=None):
    require_local_calendars(fb,profile,now)
    assert data.get('has_more') is False and not events.get('nextPageToken')
    assert p.parse_dt(fb['timeMin']) <= now < p.parse_dt(fb['timeMax'])
    assert not any(c.get('errors') for c in fb['calendars'].values())
    policy = profile['planning']; p.WORK_START = time.fromisoformat(policy['work_start'])
    task_cal=profile.get('calendars',{}).get('notion_tasks',TASK_CAL)
    tasks = p.extract_tasks(data)
    active = {c['notion_id'] for c in profile['courses'] if c.get('plan_work')}
    general = set(policy['general_task_ids']); deferred = policy['deferred_task_ids']
    def scope(t):
        return in_scope(t,profile)
    # A user-selected future day without a work interval is an intention to retain,
    # not an invitation to pull the task into today's rolling work queue.
    future_day_only = lambda t: bool(t.do_start and not t.do_end and t.do_start > now)
    eligible = [t for t in tasks if scope(t) and t.status == 'not started' and not is_fixed(t) and not future_day_only(t)]
    missed = lambda t: t.do_start is not None and (t.do_end or t.do_start) <= now
    overdue = [t for t in eligible if missed(t)]
    missing = [t for t in eligible if not t.do_start]
    if not overdue and not missing: return {'ok':True, 'moves':[], 'overdue_count':0, 'unplaced':[], 'validation_errors':[]}
    # All future tasks with actual deadlines stay fixed. Missed deadline work is prioritized.
    candidates = [t for t in eligible if not t.do_start or missed(t) or not t.due_start]
    live_events = [e for e in events.get('items', []) if e.get('status') != 'cancelled']
    removed_events = set(); conflicts = []
    for t in candidates:
        if t.do_start and t.do_end and t.do_end > now:
            hits = [e for e in live_events if t.id.replace('-', '') in re.sub(r'[-\s]', '', e.get('description', ''))]
            if len(hits) != 1 or event_interval(hits[0]) != (t.do_start, t.do_end):
                conflicts.append({'id':t.id, 'reason':'Calendar/Notion counterpart does not match; preserve for reconciliation'})
            else: removed_events.add(hits[0]['id'])
    blocked_ids = {x['id'] for x in conflicts}
    candidates = [t for t in candidates if t.id not in blocked_ids]
    movable = {t.id for t in candidates}
    effective = copy.deepcopy(fb)
    effective['calendars']['verified_external_commitments']={'busy':[{'start':e['start'],'end':e['end']} for e in policy.get('external_commitments',[])]}
    # Freebusy remains the source for every other selected calendar. Replace only confirmed
    # movable mirror events; unknown, manually changed and retained task-calendar events stay busy.
    effective['calendars'][task_cal]['busy'] = []
    for e in live_events:
        if e['id'] in removed_events: continue
        a,b = event_interval(e)
        if a and b and b > now: effective['calendars'][task_cal]['busy'].append({'start':a.isoformat(), 'end':(b+timedelta(minutes=15)).isoformat()})
    retained = [t for t in tasks if t.id not in movable and t.status in ('not started','in progress') and p.task_interval(t) and t.do_end > now]
    fixed = p.extract_busy(effective)
    fixed += [p.Interval(t.do_start,t.do_end+timedelta(minutes=15),'retained:'+t.id) for t in retained]
    busy = p.merge(fixed); daily = {};placed=[];validation_busy={}
    for t in retained:
        if scope(t):
            day=t.do_start.date().isoformat();daily[day]=daily.get(day,0)+int((t.do_end-t.do_start).total_seconds()/60)
    previous_order = lambda t:(t.do_start or now, p.natural_key(t.name), t.id)
    importance=lambda t: {'high':0,'medium':1,'low':2}.get((t.raw['properties'].get('Priority',{}).get('select') or {}).get('name','').lower(),1)
    candidates.sort(key=lambda t:(0 if t.due_start else 1, t.due_start or datetime.max.replace(tzinfo=p.TZ),importance(t),previous_order(t)))
    # Correct chapter/quiz order even when a newer video used to occupy an earlier free slot.
    for course in {t.course for t in candidates}:
        for pattern in (r'^Video\s+(\d+(?:\.\d+)*)', r'^Quiz\s+(\d+)'):
            positions=[i for i,t in enumerate(candidates) if t.course==course and not t.due_start and re.match(pattern,t.name,re.I)]
            def lesson_key(t):
                number=tuple(map(int,re.match(pattern,t.name,re.I).group(1).split('.')))
                if len(number)==2:
                    part=re.search(r'\bPart\s+(\d+)\b',t.name,re.I)
                    number += (int(part.group(1)) if part else 0,)
                return number
            ordered=sorted((candidates[i] for i in positions),key=lesson_key)
            for i,t in zip(positions,ordered):candidates[i]=t
    moves=[];unplaced=[];horizon_max=min(now+timedelta(days=28),p.parse_dt(fb['timeMax']))
    # Preserve the existing sequence of routine tasks; a long predecessor must not be overtaken.
    routine_cursor=now
    for t in candidates:
        task_fb=reusable_timeline(t,effective,calendar_details or {},profile)
        validation_busy[t.id]=p.extract_busy(task_fb)
        busy=p.merge(validation_busy[t.id]+[p.Interval(x.do_start,x.do_end+timedelta(minutes=15),'retained:'+x.id) for x in retained]+placed)
        evidence=policy['task_durations'].get(t.id)
        if not evidence:
            unplaced.append({'id':t.id,'reason':'No individual duration evidence'});continue
        minutes=evidence['minutes'];dur=timedelta(minutes=minutes)
        # Retain a manually chosen duration when it differs from the measured/estimated policy.
        if p.task_interval(t):dur=t.do_end-t.do_start;minutes=int(dur.total_seconds()/60)
        cursor=max(now,p.parse_dt(policy['earliest_start'].get(t.id)) or now)
        if not t.due_start:cursor=max(cursor,routine_cursor)
        limit=min(horizon_max,t.due_start) if t.due_start else horizon_max
        preferred=t.due_start-timedelta(days=policy.get('deadline_reserve_days',0)) if t.due_start else limit
        preferred=min(limit,preferred) if preferred>cursor else limit
        hard_limit=limit;limit=preferred
        cap=policy.get('daily_capacity_minutes',{}).get(cursor.date().isoformat(),policy['daily_work_minutes'])
        expanded=False;reserve_lost=False
        horizon=min(now+timedelta(days=7),limit);slot=None
        while cursor<limit:
            slot=p.place_task(cursor,dur,busy,horizon)
            if not slot:
                if horizon<limit:horizon=min(horizon+timedelta(days=7),limit);continue
                if limit<hard_limit:limit=hard_limit;horizon=limit;reserve_lost=True;continue
                if t.due_start and policy.get('flexible_budget') and not expanded:
                    expanded=True;cap=policy.get('flex_max_minutes',360);cursor=max(now,p.parse_dt(policy['earliest_start'].get(t.id)) or now);continue
                break
            a,b=slot;day=a.date().isoformat()
            day_cap=policy.get('daily_capacity_minutes',{}).get(day,cap)
            if daily.get(day,0)+minutes <= day_cap:break
            cursor=datetime.combine(a.date()+timedelta(days=1),p.WORK_START,p.TZ);slot=None
        if not slot:
            unplaced.append({'id':t.id,'reason':'No safe slot before deadline/horizon; retain old date'});continue
        a,b=slot;daily[day]=daily.get(day,0)+minutes;placed.append(p.Interval(a,b+timedelta(minutes=15),'move:'+t.id));busy=p.merge(busy+placed[-1:])
        if not t.due_start:routine_cursor=b+timedelta(minutes=15)
        if (a,b)==(t.do_start,t.do_end):continue
        reason='Life Organizer28Oct: urgency and importance; fixed/deadline/in-progress/completed preserved; selected calendars;08:30 start;15min buffer; flexible daily target'
        if expanded:reason+='; temporary deadline-driven daily budget increase'
        if reserve_lost:reason+='; preferred prior-day reserve could not fit'
        moves.append({'id':t.id,'name':t.name,'old_start':t.do_start.isoformat() if t.do_start else '', 'old_end':t.do_end.isoformat() if t.do_end else '', 'new_start':a.isoformat(),'new_end':b.isoformat(),'expected_status':'not started','reason':reason,'codex_log_line':f'{now:%Y-%m-%d %H:%M}: moved Do Date from {p.interval_label(t.do_start,t.do_end)} -> {p.interval_label(a,b)} (reason: {reason})'})
    errors=[];earlier=[]
    for move in moves:
        errors+=p.validate_plan([move],retained,validation_busy[move['id']]+earlier,now)
        earlier.append(p.Interval(p.parse_dt(move['new_start']),p.parse_dt(move['new_end'])+timedelta(minutes=15),'planned'))
    if any(x>policy.get('flex_max_minutes',policy['daily_work_minutes']) for x in daily.values()):errors.append('Daily work cap exceeded')
    return {'ok':not errors and not unplaced and not conflicts,'created_at':now.isoformat(),'overdue_count':len(overdue),'moves':moves,'unplaced':unplaced,'conflicts':conflicts,'validation_errors':errors,'daily_work_minutes':daily,'retained_ids':[t.id for t in retained],'effective_freebusy':effective,'removed_mirror_event_ids':sorted(removed_events)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--snapshot-dir',type=Path,required=True);ap.add_argument('--now',required=True);a=ap.parse_args();d=a.snapshot_dir.resolve()
    for kind,file in [('notion_tasks','notion'),('google_freebusy','freebusy')]:p.validate_snapshot_manifest(d/(file+'-manifest.json'),d/(file+'-latest.json'),kind)
    load=lambda name:json.loads((d/name).read_text())
    details=load('calendar-details.json') if (d/'calendar-details.json').exists() else {}
    result=plan(load('notion-latest.json'),load('freebusy-latest.json'),load('task-events.json'),json.loads((ROOT/'profile.json').read_text()),p.parse_dt(a.now),details)
    (d/'plan-rolling.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['effective_freebusy','retained_ids','removed_mirror_event_ids']},ensure_ascii=False))
    if not result['ok']:raise SystemExit(2)
if __name__=='__main__':main()
