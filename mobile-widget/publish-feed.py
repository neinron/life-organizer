"""Read-only adapter invocation and authenticated, deduplicated summary upload."""
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

root = Path(__file__).resolve().parent
config_path = Path.home() / 'Library/Application Support/Life Organizer/widget-feed.json'
result = subprocess.run(['/usr/bin/python3', str(root / 'data.py')], capture_output=True, text=True, timeout=30)
if result.returncode:
    sys.stdout.write(result.stdout)
    raise SystemExit(result.returncode)
try:
    data = json.loads(result.stdout)
    if not data.get('error') and data.get('snapshot_at') and config_path.is_file():
        config = json.loads(config_path.read_text())
        endpoint = config['endpoint']
        parsed = urllib.parse.urlsplit(endpoint)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path != '/summary' or parsed.query or parsed.fragment:
            raise ValueError('Unexpected endpoint')
        payload = {key: data.get(key) for key in ['snapshot_at', 'organizer_at', 'attention', 'updates', 'today', 'sections', 'board_at']}
        body = json.dumps(payload, ensure_ascii=False).encode()
        sha = hashlib.sha256(body).hexdigest()
        last = config.get('last_upload', {})
        if sha != last.get('sha256') and time.time() - last.get('at', 0) >= 300:
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args):
                    return None
            req = urllib.request.Request(endpoint, data=body, method='PUT', headers={
                'Content-Type': 'application/json', 'User-Agent': 'LifeOrganizer/1.0', 'Authorization': 'Bearer ' + config['write_token']})
            with urllib.request.build_opener(NoRedirect).open(req, timeout=12) as response:
                if response.status != 200 or not json.loads(response.read()).get('ok'):
                    raise ValueError('Upload not confirmed')
            config['last_upload'] = {'sha256': sha, 'at': time.time()}
            temp = config_path.with_suffix('.json.tmp')
            temp.write_text(json.dumps(config))
            os.chmod(temp, 0o600)
            temp.replace(config_path)
except (OSError, ValueError, TypeError, KeyError):
    # Do not expose URLs, tokens, payloads or errors in widget output.
    pass
sys.stdout.write(result.stdout)
