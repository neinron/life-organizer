#!/usr/bin/env python3
"""Process connector-supplied complete mail PDF inventories; defaults to preview.

No mailbox access, secrets, sends or external programs from sources. Acquires the shared lease,
or validates --lease-owner when called inside an already leased watcher run.
"""
import argparse
import importlib.util
import json
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import mail_documents as docs


def inspect(path):
    return docs.inspect_pdf(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path)
    ap.add_argument('--inspect', type=Path)
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--lease-owner')
    args = ap.parse_args()
    if args.inspect:
        print(json.dumps(inspect(args.inspect), ensure_ascii=False))
        return 0
    if not args.input:
        ap.error('--input required')
    spec = importlib.util.spec_from_file_location('lease', ROOT / 'scripts/lease.py')
    lease = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lease)
    owner = args.lease_owner or 'mail-documents-' + uuid.uuid4().hex
    if args.lease_owner:
        if not lease.PATH.exists() or json.loads(lease.PATH.read_text()).get('owner') != owner:
            raise ValueError('Existing watcher lease ownership not verified')
    elif not lease.acquire(lease.PATH, owner, os.getpid(), recover_dead=True):
        print(json.dumps({'status': 'busy', 'changes': 0}))
        return 0
    try:
        report = docs.process(json.loads(args.input.read_text()), json.loads((ROOT / 'profile.json').read_text()),
                              ROOT / 'runtime', args.apply)
        docs.sync.atomic_json(ROOT / 'runtime/reports' / (owner + ('-apply.json' if args.apply else '-preview.json')), report)
        print(json.dumps(report, ensure_ascii=False))
        return 0 if report['ok'] else 2
    finally:
        if not args.lease_owner:
            lease.release(lease.PATH, owner)


if __name__ == '__main__':
    raise SystemExit(main())
