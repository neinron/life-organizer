"""Run-only publishing; synthetic board and key, no network or app interaction."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

SCRIPT = Path(__file__).with_name('publish-feed.py')

class PublicationTests(unittest.TestCase):
    def invoke(self, publish=False, unchanged=False):
        board = {'snapshot_at': '2026-01-01T12:00:00Z', 'error': None, 'sections': []}
        fields = ['snapshot_at', 'organizer_at', 'attention', 'updates', 'today', 'sections', 'board_at']
        digest = hashlib.sha256(json.dumps({key:board.get(key) for key in fields}, ensure_ascii=False).encode()).hexdigest()
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder)/'Library/Application Support/Life Organizer/widget-feed.json'
            config.parent.mkdir(parents=True)
            config.write_text(json.dumps({'endpoint':'https://organizer.example.com/summary', 'write_token':'synthetic-key',
                'last_upload': {'sha256':digest, 'at':0} if unchanged else {}}))
            opener = MagicMock()
            response = opener.open.return_value.__enter__.return_value
            response.status = 200
            response.read.return_value = b'{"ok":true}'
            with patch('pathlib.Path.home', return_value=Path(folder)), \
                 patch.object(sys, 'argv', [str(SCRIPT)]+(['--publish'] if publish else [])), \
                 patch('subprocess.run', return_value=subprocess.CompletedProcess([],0,json.dumps(board),'')) as run, \
                 patch('urllib.request.build_opener', return_value=opener), \
                 contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(SCRIPT),run_name='__main__')
            return opener.open.call_count, run.call_count

    def test_plain_widget_read_never_uploads_or_refreshes(self):
        self.assertEqual(self.invoke(), (0,1))

    def test_run_completion_uploads_and_refreshes_once(self):
        self.assertEqual(self.invoke(publish=True), (1,2))

    def test_unchanged_run_refreshes_locally_without_upload(self):
        self.assertEqual(self.invoke(publish=True,unchanged=True), (0,2))

if __name__ == '__main__': unittest.main()
