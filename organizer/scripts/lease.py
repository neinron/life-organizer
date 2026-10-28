#!/usr/bin/env python3
"""A shared lease for watcher, file sync and Downloads cleanup; print busy instead of racing."""
import argparse, fcntl, json, os, time
from pathlib import Path
PATH=Path(__file__).resolve().parents[1]/'runtime/state/run-lease.json'
def alive(pid):
    try:os.kill(pid,0);return True
    except ProcessLookupError:return False
    except PermissionError:return True
def acquire(path,owner,pid=None,recover_dead=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.with_suffix('.guard').open('a') as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        if path.exists():
            try:previous=json.loads(path.read_text())
            except (ValueError,OSError):return False
            previous_pid=previous.get('pid')
            if not (recover_dead and isinstance(previous_pid,int) and previous_pid>1 and not alive(previous_pid)):return False
            with path.with_name('lease-recovery.jsonl').open('a') as log:log.write(json.dumps({'recovered_at':time.time(),'previous':previous,'new_owner':owner})+'\n')
            path.unlink()
        fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as out:json.dump({'owner':owner,'created':time.time(),'pid':pid},out)
        return True
def release(path,owner):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.with_suffix('.guard').open('a') as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        if path.exists():
            if json.loads(path.read_text())['owner']!=owner:raise ValueError('lease owner mismatch')
            path.unlink()
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('action',choices=['acquire','release']);ap.add_argument('owner');ap.add_argument('--pid',type=int);ap.add_argument('--recover-dead',action='store_true');a=ap.parse_args()
    if a.action=='acquire':
        ok=acquire(PATH,a.owner,a.pid,a.recover_dead);print('acquired' if ok else 'busy — existing lease retained');raise SystemExit(0 if ok else 2)
    release(PATH,a.owner);print('released')
