"""Read-only desktop view of the Life Organizer's saved, complete snapshots."""
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from displays import displays

CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'config.json').read_text())
ROOT = Path(CONFIG['organizer_root']).expanduser().resolve()
TZ = ZoneInfo('Europe/Berlin')
CHAT = CONFIG.get('chat_url', '')


def read(path):
    return json.loads(path.read_text())


def date(value):
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.replace(tzinfo=TZ) if result.tzinfo is None else result.astimezone(TZ)
    except (ValueError, TypeError):
        return None


def snapshot():
    manifests = sorted((ROOT / 'runtime/reports').glob('*/notion-manifest.json'),
                       key=lambda p: p.stat().st_mtime, reverse=True)
    for manifest in manifests:
        try:
            meta = read(manifest)
            info = meta.get('notion_tasks', {})
            path = Path(info.get('path', ''))
            if not meta.get('ok') or not path.is_file() or not path.resolve().is_relative_to(ROOT / 'runtime/reports'):
                continue
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != info.get('sha256'):
                continue
            data = json.loads(raw)
            if data.get('has_more') is not False or len(data.get('results', [])) != info.get('row_count'):
                continue
            stamp = date(meta.get('created_at'))
            if stamp:
                return data['results'], stamp
        except (OSError, ValueError, TypeError):
            continue
    return [], None


def in_scope(row, profile):
    props = row.get('properties', {})
    norm = lambda x: x.replace('-', '')
    rels = {norm(x['id']) for x in props.get('Course', {}).get('relation', [])}
    courses = profile.get('courses', [])
    blocked = {norm(c['notion_id']) for c in courses + profile.get('excluded_courses', [])
               if c.get('notion_id') and not c.get('plan_work')}
    if rels & blocked:
        return False
    policy = profile.get('planning', {})
    personal = policy.get('personal', {})
    if personal.get('enabled'):
        if norm(row['id']) in {norm(x) for x in personal.get('task_ids', [])}:
            return True
        if rels & {norm(x) for x in personal.get('context_ids', [])}:
            return True
        if not rels and row.get('created_time', '')[:10] >= personal.get('standalone_created_since', '9999-12-31'):
            return True
    active = {norm(c['notion_id']) for c in courses if c.get('plan_work')}
    reg = props.get('Registration', {})
    registered = reg.get('checkbox') is True or any(x.get('checkbox') is True for x in reg.get('rollup', {}).get('array', []))
    return registered and (bool(rels & active) or norm(row['id']) in {norm(x) for x in policy.get('general_task_ids', [])})


def main():
    now = datetime.now(TZ)
    profile = read(ROOT / 'profile.json')
    state = read(ROOT / 'runtime/state/watcher.json')
    rows, stamp = snapshot()
    tasks = []
    for row in rows:
        p = row.get('properties', {})
        status = (p.get('Status', {}).get('status') or p.get('Status', {}).get('select') or {}).get('name', '').lower()
        if row.get('archived') or row.get('in_trash') or status not in ('not started', 'in progress', 'in-progress') or not in_scope(row, profile):
            continue
        title = ''.join(x.get('plain_text') or x.get('text', {}).get('content', '') for x in p.get('Name', {}).get('title', []))
        do = p.get('Do Date', {}).get('date') or {}
        due = p.get('Due Date', {}).get('date') or {}
        tasks.append({'id': row['id'], 'title': title, 'start': do.get('start'), 'due': due.get('start')})
    today = sorted([t for t in tasks if date(t['start']) and date(t['start']).date() == now.date()], key=lambda t: t['start'])
    soon = sorted([t for t in tasks if date(t['due']) and now.date() <= date(t['due']).date() <= (now + timedelta(days=7)).date()], key=lambda t: date(t['due']))
    attention = []
    task_by_id = {t['id']: t for t in tasks}
    for item in state.get('pending', []):
        if item.get('status') in ('resolved', 'completed', 'done'):
            continue
        text = item.get('widget_text')
        if isinstance(text, str) and text.strip():
            attention.append({'id': item.get('notion_id'),
                'label': item.get('widget_label', 'Noch zu klären'), 'text': text.strip()[:500]})
    covered = {a.get('id') for a in attention}
    for task in soon:
        due = date(task['due'])
        if task['id'] not in covered and due.date() <= (now + timedelta(days=1)).date():
            when = due.strftime('%d.%m.') + (due.strftime(' um %H:%M') if len(task['due']) > 10 else '')
            attention.append({'id': task['id'], 'label': 'Zeitnah wichtig',
                'text': task['title'] + ': Die gespeicherte Frist ist am ' + when + '. Die Aufgabe ist im letzten Stand noch offen.'})
    priority = {'Entscheidung nötig': 0, 'Zeitnah wichtig': 1, 'Noch zu klären': 2}
    attention.sort(key=lambda item: (priority.get(item['label'], 3), date(task_by_id.get(item.get('id'), {}).get('due')) or now + timedelta(days=30)))
    attention = attention[:3]
    updates = []
    for item in state.get('widget_updates', []):
        if not isinstance(item, dict):
            continue
        checked = date(item.get('verified_at'))
        text = item.get('text')
        if checked and 0 <= (now - checked).total_seconds() <= 7 * 86400 and isinstance(text, str):
            updates.append(text[:500])
    overview = ('Im gespeicherten Plan stehen heute ' + str(len(today)) + ' Aufgaben. ' if today else 'Im gespeicherten Plan stehen heute keine Aufgaben. ')
    overview += ('Es gibt ' + str(len(attention)) + ' Hinweise, die deine Aufmerksamkeit brauchen.' if attention else 'Im gespeicherten Stand sind keine zusätzlichen dringenden Hinweise erkannt.')

    today_ids = {t['id'] for t in today[:3]}
    soon = [t for t in soon if t['id'] not in today_ids]
    stamp_text = stamp.strftime('%d.%m. · %H:%M') if stamp else 'nicht verfügbar'
    stale = stamp is None or (now - stamp).total_seconds() > 12 * 3600
    latest = date((state.get('last_source_processing_success') or {}).get('verified_at'))
    print(json.dumps({'date': now.strftime('%d.%m.%Y'), 'chat': CHAT,
                      'external_display': any(not d['builtin'] for d in (displays() or [])),
                      'overview': overview, 'attention': attention, 'updates': updates[:1],
                      'today': today[:2], 'today_count': len(today), 'soon': soon[:2],
                      'snapshot_at': stamp.isoformat() if stamp else None,
                      'snapshot_label': stamp_text, 'stale': stale,
                      'organizer_at': latest.isoformat() if latest else None,
                      'note': 'Gespeicherter Stand · neuer Abgleich ausstehend' if stale else 'Aus dem letzten Organizer-Abgleich'}, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(json.dumps({'error': 'Organizer-Daten gerade nicht lesbar.', 'chat': CHAT, 'today': [], 'soon': []}, ensure_ascii=False))
