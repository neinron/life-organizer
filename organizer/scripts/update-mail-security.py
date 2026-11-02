#!/usr/bin/env python3
"""Refresh local ClamAV signatures at most daily; never uploads user documents."""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECURITY = ROOT / 'runtime/security'
if __name__ == '__main__':
    SECURITY.mkdir(parents=True, exist_ok=True, mode=0o700)
    state = SECURITY / 'update.json'
    if state.exists() and time.time() - json.loads(state.read_text()).get('last_success', 0) < 86400:
        print(json.dumps({'status': 'current'})); raise SystemExit(0)
    db = SECURITY / 'clamav'; db.mkdir(exist_ok=True, mode=0o700)
    config = SECURITY / 'freshclam.conf'
    config.write_text(f'DatabaseDirectory "{db}"\nDatabaseMirror database.clamav.net\nConnectTimeout 20\nReceiveTimeout 30\nMaxAttempts 1\nTestDatabases yes\n')
    p = subprocess.run(['/opt/homebrew/bin/freshclam', '--config-file=' + str(config), '--stdout'],
                       capture_output=True, text=True, timeout=240)
    if p.returncode:
        print(json.dumps({'status': 'update_failed', 'detail': p.stdout[-1500:] + p.stderr[-1500:]}))
        raise SystemExit(1)
    state.write_text(json.dumps({'last_success': time.time(), 'status': 'updated'}))
    print(json.dumps({'status': 'updated'}))
