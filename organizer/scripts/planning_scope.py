"""Current academic tasks plus explicitly enabled personal contexts and new standalone tasks."""
from datetime import datetime

def is_fixed(task):
    return task.raw.get('properties',{}).get('Fixiert',{}).get('checkbox') is True

def in_scope(task, profile):
    policy=profile['planning'];props=task.raw['properties']
    rels={r['id'] for r in props.get('Course',{}).get('relation',[])}
    blocked={c['notion_id'] for c in profile.get('excluded_courses',[]) if c.get('notion_id')}
    blocked|={c['notion_id'] for c in profile['courses'] if not c.get('plan_work')}
    if rels & blocked or task.id in policy['deferred_task_ids']:return False
    personal=policy.get('personal',{})
    if personal.get('enabled'):
        if task.id in personal.get('task_ids',[]) or rels & set(personal.get('context_ids',[])):return True
        created=task.raw.get('created_time') or props.get('Created time',{}).get('created_time')
        if not rels and created and created[:10]>=personal.get('standalone_created_since','9999-12-31'):return True
    active={c['notion_id'] for c in profile['courses'] if c.get('plan_work')}
    registered=props.get('Registration',{})
    registered=registered.get('checkbox') is True or any(x.get('checkbox') is True for x in registered.get('rollup',{}).get('array',[]))
    return registered and (bool(rels & active) or task.id in policy['general_task_ids'])
