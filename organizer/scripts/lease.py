#!/usr/bin/env python3
"""A shared lease for watcher, file sync and Downloads cleanup; print busy instead of racing."""
import argparse, json, os, time
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'runtime/state/run-lease.json'
ap=argparse.ArgumentParser();ap.add_argument('action',choices=['acquire','release']);ap.add_argument('owner');a=ap.parse_args()
p.parent.mkdir(parents=True,exist_ok=True)
if a.action=='acquire':
    try:
        fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as f:json.dump({'owner':a.owner,'created':time.time()},f)
        print('acquired')
    except FileExistsError:
        print('busy — inspect the existing lease; do not remove an active run lock')
        raise SystemExit(2)
else:
    if p.exists():
        if json.loads(p.read_text())['owner']!=a.owner:raise SystemExit('lease owner mismatch')
        p.unlink()
    print('released')
