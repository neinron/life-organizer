"""Render only the organizer-authored board. No topic or section templates."""
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from displays import displays
CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'config.json').read_text())
ROOT = Path(CONFIG['organizer_root']).expanduser().resolve()
TZ = ZoneInfo('Europe/Berlin')
CHAT = CONFIG.get('chat_url', '')

def main():
    try:
        board = json.loads((ROOT / 'runtime/state/widget-board.json').read_text())
        stamp = datetime.fromisoformat(board['verified_at'].replace('Z', '+00:00'))
        if stamp.tzinfo is None or stamp > datetime.now(TZ) + timedelta(minutes=5):
            raise ValueError('Invalid source date')
        sections = board['sections']
        if not isinstance(sections, list):
            raise ValueError('Invalid sections')
        error = None
    except (OSError, ValueError, KeyError, TypeError):
        sections, stamp, error = [], None, 'Noch keine verifizierte Übersicht vorhanden.'
    print(json.dumps({'sections': sections, 'board_at': stamp.isoformat() if stamp else None,
        'snapshot_at': stamp.isoformat() if stamp else None, 'organizer_at': stamp.isoformat() if stamp else None,
        'chat': CHAT, 'external_display': any(not d['builtin'] for d in (displays() or [])),
        'attention': [], 'today': [], 'updates': [], 'error': error}, ensure_ascii=False))
if __name__ == '__main__':
    main()
