"""Require the live extra calendar coverage before any automatic planning."""
from datetime import datetime,timezone,timedelta
def require_local_calendars(freebusy,profile,now=None):
    cfg=profile.get('local_calendars',{})
    if not cfg.get('enabled'):return
    ids=cfg.get('calendar_ids',[])
    if not ids or any('apple:'+cid not in freebusy['calendars'] for cid in ids):
        raise ValueError('Exchange/iCloud coverage missing: run scripts/local-calendars.py before planning')
    stamp=freebusy.get('native_calendar_checked_at')
    if not stamp or (now or datetime.now(timezone.utc))-datetime.fromisoformat(stamp.replace('Z','+00:00'))>timedelta(minutes=15):
        raise ValueError('Exchange/iCloud coverage is stale: refresh before planning')
