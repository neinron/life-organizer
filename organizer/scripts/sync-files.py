#!/usr/bin/env python3
"""Copy verified staged course files without replacing or deleting user files."""
import argparse, hashlib, json, os, re, sys, tempfile
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {'Vorlesungen', 'Übungen', 'Prüfungen', 'Organisation', 'Literatur', 'Hacking Challenges'}

def is_quiet_hours(profile, now=None):
    quiet = profile.get('quiet_hours')
    if not quiet or quiet.get('enabled') is False: return False
    local = (now or datetime.now(ZoneInfo(quiet['timezone']))).astimezone(ZoneInfo(quiet['timezone']))
    clock = local.strftime('%H:%M')
    return clock >= quiet['start'] or clock < quiet['end']

def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def atomic_json(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=p.parent)
    try:
        with os.fdopen(fd, 'w') as f: json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n')
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def sync_one(item, profile, staging, apply=False):
    if is_quiet_hours(profile): return {'status': 'quiet_hours'}
    if item.get('scope') == 'mail_document':
        # Paths come only from the private, user-controlled route registry, never mail text.
        route = profile.get('mail_documents', {}).get('routes', {}).get(item.get('route_id'))
        if not route or not route.get('enabled', True): raise ValueError('Unknown document route')
        if item.get('verified') is not True or not item.get('source_id') or not item.get('source_url'):
            raise ValueError('Unverified mail document')
        origin = urlparse(item.get('source_url', ''))
        if (item.get('challenge') or item.get('challenge_id') or item.get('category') == 'Hacking Challenges'
                or re.search(r'pwn\d{2}_\d{2}|hacking[ _-]?challenge', item['name'], re.I)
                or (origin.hostname == 'netsec.net.in.tum.de' and origin.path.startswith('/tasks/'))
                or not item['name'].lower().endswith('.pdf')):
            raise ValueError('Only verified non-challenge PDFs allowed on document routes')
        target_dir = Path(route['root'])
        if not target_dir.is_absolute(): raise ValueError('Document root must be absolute')
        current = Path(target_dir.anchor)
        for part in target_dir.parts[1:]:
            current = current / part
            if current.is_symlink(): raise ValueError('Destination symlink refused')
        return copy_verified(item, staging, target_dir, apply)
    course = next((c for c in profile['courses'] if c['key'] == item['course']), None)
    if not course: raise ValueError('Unknown course')
    if course.get('mode') == 'excluded': raise ValueError('Excluded course')
    if item.get('category') not in CATEGORIES: raise ValueError('Unknown category')
    if item.get('challenge') or item.get('category') == 'Hacking Challenges' or any(x in str(item.get('name', '')).lower() for x in ['pwn_', 'hacking challenge']):
        allowed = profile.get('systems', {}).get('netsec_challenges', {}).get('authorized_download_ids', [])
        origin = urlparse(item.get('source_url', ''))
        if not (item.get('challenge') is True and item['course'] == 'netsec'
                and item['category'] == 'Hacking Challenges'
                and item.get('challenge_id') in allowed
                and origin.scheme == 'https' and origin.hostname == 'netsec.net.in.tum.de'
                and not origin.username and not origin.password and origin.port in (None, 443)):
            raise ValueError('Hacking challenge download is not authorized for this source/course/ID')
    base = Path(profile['study_root']).resolve() / profile['semester_folder']
    folder = Path(course['folder'])
    if folder.is_absolute() or '..' in folder.parts: raise ValueError('Unsafe course directory')
    target_dir = base / folder / item['category']
    current = Path(profile['study_root']).resolve()
    for part in [profile['semester_folder'], *folder.parts, item['category']]:
        current = current / part
        if current.is_symlink(): raise ValueError('Destination symlink refused')
    return copy_verified(item, staging, target_dir, apply)

def copy_verified(item, staging, target_dir, apply=False):
    name = item['name']
    if not isinstance(name, str) or name in ('', '.', '..') or Path(name).name != name or '\\' in name or any(ord(c) < 32 for c in name):
        raise ValueError('Unsafe filename')
    rel = Path(item['staged_path'])
    if rel.is_absolute() or '..' in rel.parts: raise ValueError('Unsafe staged path')
    source = staging / rel
    if staging.is_symlink(): raise ValueError('Symlink refused')
    current = staging
    for part in rel.parts:
        current = current / part
        if current.is_symlink(): raise ValueError('Symlink refused')
    if not source.resolve().is_relative_to(staging.resolve()) or not source.is_file(): raise ValueError('Missing staged file')
    expected = item['sha256']
    if digest(source) != expected: raise ValueError('Staged hash mismatch')
    if item.get('scope') == 'mail_document':
        sys.path.insert(0, str(ROOT / 'lib'))
        from pdf_security import assess
        assess(source)  # Never trust a queue's verified:true flag as a malware verdict.
    target = target_dir / name
    if target.is_symlink(): raise ValueError('Destination symlink refused')
    if target.exists():
        if target.is_file() and digest(target) == expected: return {'status':'already_present','target':str(target)}
        target = target.with_name(f'{target.stem}__{expected[:12]}{target.suffix}')
        if target.is_symlink(): raise ValueError('Destination symlink refused')
        if target.exists():
            if target.is_file() and digest(target) == expected: return {'status':'already_present','target':str(target)}
            raise ValueError('Conflicting version destination exists')
    if not apply: return {'status':'planned','target':str(target)}
    target_dir.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents a race from overwriting a file created after the checks.
    with source.open('rb') as src, target.open('xb') as dst:
        if item.get('scope') == 'mail_document':
            from pdf_security import quarantine
            quarantine(target)
        for block in iter(lambda: src.read(1024 * 1024), b''): dst.write(block)
        dst.flush(); os.fsync(dst.fileno())
    if digest(target) != expected: raise ValueError('Destination verification failed')
    return {'status':'copied','target':str(target)}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--apply',action='store_true'); args=ap.parse_args()
    profile=json.loads((ROOT/'profile.json').read_text()); queue_path=ROOT/'runtime/state/files.json'
    if is_quiet_hours(profile):
        print(json.dumps({'apply':args.apply,'status':'quiet_hours','results':[]})); return
    queue=json.loads(queue_path.read_text()); results=[]
    for item in queue['items']:
        if item.get('status') in ('copied','already_present'): continue
        try: result=sync_one(item, profile, ROOT/'runtime/staging',args.apply)
        except (ValueError, OSError, KeyError) as e: result={'status':'deferred','reason':str(e)}
        results.append({'id':item.get('id'),**result})
        if result['status']=='quiet_hours': break
        if args.apply:
            item.update(result); atomic_json(queue_path,queue)
    print(json.dumps({'apply':args.apply,'results':results},ensure_ascii=False,indent=2))

if __name__ == '__main__': main()
