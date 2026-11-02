"""PDF inventory, conservative routing and resumable filing. No mailbox writes or credentials.

Connectors supply complete MIME inventories and original bytes. Content is evidence, never code
or a destination path. This module uses the existing verified file queue and copy implementation.
"""
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sync_files', ROOT / 'scripts/sync-files.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
MAX_BYTES = 25 * 1024 * 1024


def stamp():
    return datetime.now(timezone.utc).isoformat()


def key(value):
    return hashlib.sha256(value.encode()).hexdigest()


def canonical_link(url):
    p = urlsplit(url)
    if p.scheme != 'https' or not p.hostname or p.username or p.password:
        raise ValueError('Only public HTTPS document links allowed')
    if p.query:
        # Do not persist tracking/signature/access-token query parameters.
        raise ValueError('Link with query parameters needs connector review')
    if p.hostname.lower() in ('arxiv.org', 'www.arxiv.org'):
        match = re.fullmatch(r'/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?', p.path)
        if match:
            return 'https://arxiv.org/pdf/' + match[1]
    return urlunsplit(('https', p.netloc.lower(), p.path, '', ''))


def candidates(message):
    """Always inspect the full MIME list, even when listing metadata said attachments:[]."""
    out = []
    seen_names = {}
    for a in message.get('attachments', []):
        a = {'name': a} if isinstance(a, str) else a
        name = a.get('name') or a.get('filename') or 'attachment.pdf'
        if not (name.lower().endswith('.pdf') or a.get('mime_type', a.get('mime', '')).split(';')[0] == 'application/pdf'):
            continue
        occurrence = seen_names.get(name, 0)
        seen_names[name] = occurrence + 1
        locator = f'attachment:{name}:{occurrence}'
        out.append({**a, 'name': name, 'kind': 'attachment', 'locator': locator})
    links = message.get('links', [])[:]
    for url in re.findall(r'https://[^\s<>"\[\]]+', message.get('text', '')):
        url = url.rstrip('.,);')
        if re.search(r'\.pdf(?:$|[?#])|https://(?:www\.)?arxiv\.org/(?:abs|pdf)/', url, re.I):
            links.append(url)
    seen = set()
    for obj in links:
        a = {'url': obj} if isinstance(obj, str) else obj
        original = a['url']
        try:
            url = canonical_link(original)
        except ValueError:
            url = original.split('?', 1)[0].split('#', 1)[0]
            a = {**a, 'link_review_required': True}
        if url in seen:
            continue
        seen.add(url)
        name = a.get('name') or unquote(urlsplit(url).path.rsplit('/', 1)[-1])
        if not name.lower().endswith('.pdf'):
            name += '.pdf'
        artifacts = message.get('link_artifacts', {})
        out.append({**a, **artifacts.get(original, artifacts.get(url, {})), 'kind': 'link',
                    'url': url, 'name': name, 'locator': 'link:' + url})
    return out


def inspect_pdf(path):
    """Local malware scan followed by an isolated, bounded structural/text inspection."""
    from pdf_security import assess
    verdict = assess(path)
    return {**verdict['pdf'], 'security': {k: verdict[k] for k in
            ('policy', 'database', 'sha256', 'checked_at', 'scanner', 'status')}}


def checked_path(path):
    path = Path(path).absolute()
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if current.is_symlink():
            raise ValueError('Source/destination symlink refused')
    return path


def match_route(message, candidate, pdf, config):
    # Agent decisions may choose an existing route ID with an explicit rationale, never a mail path.
    explicit = candidate.get('route_id') or message.get('route_id')
    reason = candidate.get('routing_reason') or message.get('routing_reason')
    if explicit:
        if explicit not in config.get('routes', {}) or not reason:
            raise ValueError('Document route requires configured ID and evidence')
        return explicit, reason
    context = ' '.join([message.get('subject', ''), message.get('text', ''),
                        candidate['name'], pdf.get('title', ''), pdf.get('text', '')]).casefold()
    sender = ' '.join(message.get('from', []) if isinstance(message.get('from'), list)
                      else [message.get('from', '')]).casefold()
    matches = []
    for rid, route in config.get('routes', {}).items():
        if route.get('enabled', True) is False:
            continue
        for rule in route.get('rules', []):
            terms = rule.get('all_terms', [])
            senders = rule.get('senders', [])
            if terms and all(t.casefold() in context for t in terms) and (not senders or any(s.casefold() in sender for s in senders)):
                matches.append(rid)
                break
    if len(set(matches)) != 1:
        raise ValueError('Ambiguous or unknown project; routing remains open')
    return matches[0], 'Configured sender/context rule plus PDF content inspection'


def find_duplicate(root, sha):
    checked_path(root)
    if not root.exists():
        return None
    for path in sorted(p for p in root.rglob('*') if p.suffix.lower() == '.pdf'):
        if path.is_symlink():
            continue
        checked_path(path)
        if sync.digest(path) == sha:
            return path
    return None


def audit(state):
    results = []
    for mid, mail in state.get('messages', {}).items():
        for cid, record in mail.get('documents', {}).items():
            if record.get('status') != 'verified':
                continue
            try:
                path = checked_path(record['target'])
                ok = path.is_file() and path.stat().st_size == record['size'] and sync.digest(path) == record['sha256']
            except (ValueError, OSError):
                ok = False
            results.append({'message': mid, 'document': cid, 'status': 'verified' if ok else 'missing_or_changed'})
    return results


def process(batch, profile, runtime, apply=False):
    config = profile.get('mail_documents', {})
    if not config.get('enabled'):
        raise ValueError('Mail document processing is disabled')
    state_path = runtime / 'state/mail-documents.json'
    queue_path = runtime / 'state/files.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'version': 1, 'messages': {}}
    queue = json.loads(queue_path.read_text()) if queue_path.exists() else {'items': []}
    staging = runtime / 'staging'
    report = {'messages': [], 'changes': 0}
    for message in batch.get('messages', []):
        # Message-ID survives a moved/re-listed message; provider is part of its namespace.
        identity = message.get('message_id') or message.get('source_id')
        if not identity or not message.get('account'):
            raise ValueError('Stable message identity/account required')
        mid = key(message['account'] + ':' + identity)
        mail = state['messages'].setdefault(mid, {'documents': {}})
        mail.update(source_id=message['source_id'], message_id=message.get('message_id'), account=message['account'])
        if message.get('attachments_complete') is not True or message.get('body_complete') is not True:
            mail.update(status='inventory_incomplete', reason='Complete full-content MIME inventory and body required')
            report['messages'].append({'id': mid, 'status': mail['status']})
            continue
        docs = candidates(message)
        expected = []
        for candidate in docs:
            cid = key(candidate['locator'])
            expected.append(cid)
            previous = mail['documents'].get(cid, {})
            record = {'name': candidate['name'], 'kind': candidate['kind'], 'status': 'open'}
            mail['documents'][cid] = record
            try:
                # These boundaries cannot be overridden by an agent routing choice.
                if (message.get('excluded') or message.get('challenge') or candidate.get('challenge')
                        or re.search(r'\bpwn\d{2}_\d{2}\b', candidate['name'], re.I)):
                    raise ValueError('Excluded course or challenge: document pipeline refused')
                blocked = config.get('excluded_terms', ['data driven innovation', 'hacking challenge'])
                context = (message.get('subject', '') + ' ' + candidate['name']).casefold()
                if any(t.casefold() in context for t in blocked):
                    raise ValueError('Excluded material: document pipeline refused')
                source = candidate.get('local_path')
                if not source and previous.get('sha256'):
                    staged = staging / 'mail-documents' / (previous['sha256'] + '.pdf')
                    source = str(staged if staged.is_file() else previous.get('target', ''))
                if not source:
                    raise ValueError('Original bytes missing; retrieve via read-only connector/public PDF source')
                path = checked_path(source)
                size = path.stat().st_size
                if size <= 0 or size > MAX_BYTES:
                    raise ValueError('PDF size outside local 25 MiB limit')
                if candidate.get('size') is not None and size != candidate['size']:
                    raise ValueError('Attachment size mismatch')
                sha = sync.digest(path)
                if candidate.get('sha256') and candidate['sha256'] != sha:
                    raise ValueError('Source SHA-256 mismatch')
                r2 = candidate.get('r2_key', '')
                if re.fullmatch(r'files/[a-f0-9]{40}', r2) and not sha.startswith(r2[6:]):
                    raise ValueError('Collector content hash mismatch')
                pdf = inspect_pdf(path)
                route_id, reason = match_route(message, candidate, pdf, config)
                route = config['routes'][route_id]
                if not route.get('enabled', True):
                    raise ValueError('Document route disabled')
                root = checked_path(route['root'])
                record.update(sha256=sha, size=size, pages=pdf['pages'], title=pdf['title'],
                              security=pdf.get('security'),
                              route_id=route_id, routing_reason=reason,
                              source_url=candidate.get('url') or message.get('source_url') or message['source_id'])
                duplicate = find_duplicate(root, sha)
                if duplicate:
                    if apply:
                        from pdf_security import quarantine
                        quarantine(duplicate)
                    record.update(status='verified', target=str(duplicate), disposition='existing_identical', checked_at=stamp())
                    continue
                name = candidate.get('save_name', candidate['name'])
                if not name.lower().endswith('.pdf'):
                    name += '.pdf'
                if (Path(name).name != name or '\\' in name or any(ord(c) < 32 for c in name)):
                    raise ValueError('Unsafe filename')
                staged_path = 'mail-documents/' + sha + '.pdf'
                item = {'id': 'mail-document:' + mid + ':' + cid, 'scope': 'mail_document',
                        'route_id': route_id, 'name': name, 'staged_path': staged_path,
                        'verified': True, 'sha256': sha, 'source_id': message['source_id'],
                        'source_url': record['source_url'], 'status': 'pending'}
                if apply:
                    staged = staging / staged_path
                    checked_path(staged)
                    staged.parent.mkdir(parents=True, exist_ok=True)
                    if not staged.exists():
                        # Never replace a different staged object; exclusive creation.
                        with path.open('rb') as src, staged.open('xb') as dst:
                            shutil.copyfileobj(src, dst)
                    if sync.digest(staged) != sha:
                        raise ValueError('Staging verification failed')
                    old = next((q for q in queue['items'] if q.get('id') == item['id']), None)
                    if old:
                        old.update(item)
                        item = old
                    else:
                        queue['items'].append(item)
                    sync.atomic_json(queue_path, queue)  # Durable before target mutation; resume on failure.
                    preview = sync.sync_one(item, profile, staging)
                    result = sync.sync_one(item, profile, staging, True)
                    if result['target'] != preview['target']:
                        raise ValueError('Destination changed since preview')
                    item.update(result)
                    sync.atomic_json(queue_path, queue)
                    record.update(status='verified', target=result['target'], disposition=result['status'], checked_at=stamp())
                    report['changes'] += result['status'] == 'copied'
                else:
                    record.update(status='planned', target=str(root / name))
            except (ValueError, OSError, KeyError, subprocess.TimeoutExpired) as exc:
                record.update(status='open', reason=str(exc))
                # Retain recovery data after a missing/changed original or destination.
                for field in ('sha256', 'target', 'size', 'route_id'):
                    if field not in record and field in previous:
                        record[field] = previous[field]
        mail['expected'] = expected
        mail['status'] = 'complete' if all(mail['documents'][c]['status'] == 'verified' for c in expected) else 'open'
        mail.pop('reason', None)
        mail['checked_at'] = stamp()
        report['messages'].append({'id': mid, 'status': mail['status'], 'documents': {c: mail['documents'][c] for c in expected}})
    report['audit'] = audit(state)
    report['open'] = sum(m.get('status') != 'complete' for m in state['messages'].values())
    report['ok'] = not report['open'] and all(a['status'] == 'verified' for a in report['audit'])
    if apply:
        sync.atomic_json(state_path, state)
    return report
