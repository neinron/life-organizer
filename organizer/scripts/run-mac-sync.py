#!/usr/bin/env python3
"""One repeatable preview/apply run, holding the shared lease until the report is saved."""
import json, os, subprocess, sys, uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    now = datetime.now(timezone.utc)
    owner = 'mac-sync-' + now.strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    command = lambda *args: subprocess.run([sys.executable, *args], cwd=ROOT, capture_output=True, text=True)
    lease = command('scripts/lease.py', 'acquire', owner, '--pid', str(os.getpid()), '--recover-dead')
    if lease.returncode == 2:
        print(json.dumps({'status': 'busy', 'changes': 0})); return 0
    if lease.returncode:
        print(json.dumps({'status': 'error', 'changes': 0, 'error': lease.stderr or lease.stdout})); return 1
    report = {'run_id': owner, 'started_at': now.isoformat(), 'changes': 0}
    code = 0
    try:
        preview = command('scripts/sync-files.py')
        if preview.returncode: raise RuntimeError(preview.stderr)
        report['preview'] = json.loads(preview.stdout)
        unsafe = [r for r in report['preview']['results'] if r['status'] not in ('planned', 'already_present')]
        if unsafe:
            report.update(status='deferred', deferred=unsafe); code = 1
        else:
            applied = command('scripts/sync-files.py', '--apply')
            if applied.returncode: raise RuntimeError(applied.stderr)
            report['apply'] = json.loads(applied.stdout)
            report['changes'] = sum(r['status'] == 'copied' for r in report['apply']['results'])
            failed = [r for r in report['apply']['results'] if r['status'] not in ('copied', 'already_present')]
            report['status'] = 'deferred' if failed else 'changed' if report['changes'] else 'unchanged'
            code = int(bool(failed))
    except Exception as exc:
        report.update(status='error', error=str(exc)); code = 1
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        try:
            p = ROOT / 'runtime/reports' / (owner + '.json')
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        finally:
            released = command('scripts/lease.py', 'release', owner)
            if released.returncode:
                report['lease_release_error'] = released.stderr; code = 1
                p.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False)); return code

if __name__ == '__main__': sys.exit(main())
