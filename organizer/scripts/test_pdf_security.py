"""Synthetic local fixtures only: no malware download and no source-provided program execution."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from pypdf import PdfWriter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import pdf_security as security


class PdfSecurityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()

    def inspect_fixture(self, writer):
        path = self.root / 'fixture.pdf'; writer.write(path)
        return security.isolated(security.inspector_command(path), [path])

    def test_active_javascript_and_embedded_files_rejected(self):
        for kind in ('js', 'embedded'):
            writer = PdfWriter(); writer.add_blank_page(width=100, height=100)
            if kind == 'js': writer.add_js('app.alert("synthetic test only")')
            else: writer.add_attachment('example.txt', b'synthetic harmless attachment')
            result = self.inspect_fixture(writer)
            self.assertNotEqual(result.returncode, 0)

    def test_plain_pdf_readable_in_isolation(self):
        writer = PdfWriter(); writer.add_blank_page(width=100, height=100)
        result = self.inspect_fixture(writer)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['pages'], 1)

    def test_network_private_file_and_write_access_denied(self):
        sentinel = self.root / 'sentinel.txt'; sentinel.write_text('not a secret')
        output = self.root / 'must-not-exist.txt'
        code = '''import json,socket
r={}
for name,op in [('read',lambda:open(%r).read()),('write',lambda:open(%r,'w')),('network',lambda:socket.create_connection(('127.0.0.1',9),timeout=1))]:
 try:op();r[name]=False
 except PermissionError:r[name]=True
print(json.dumps(r))
''' % (str(sentinel), str(output))
        result = security.isolated([sys.executable, '-I', '-B', '-c', code], [])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'read':True,'write':True,'network':True})
        self.assertFalse(output.exists())

    def test_missing_and_stale_signatures_fail_closed(self):
        with patch.object(security, 'DB', self.root):
            with self.assertRaises(ValueError): security.database_version()
            daily = self.root / 'daily.cvd'; daily.write_bytes(b'synthetic')
            old = time.time()-4*86400; os.utime(daily, (old,old))
            with self.assertRaises(ValueError): security.database_version()

    def test_scan_failure_prevents_parser(self):
        pdf = self.root / 'test.pdf'; pdf.write_bytes(b'%PDF-1.7\n%%EOF')
        with patch.object(security, 'quarantine'), patch.object(security,'database_version',return_value='test'), \
             patch.object(security,'SECURITY',self.root), \
             patch.object(security,'isolated',return_value=subprocess.CompletedProcess([],2,'','failed')) as runner:
            with self.assertRaises(ValueError): security.assess(pdf)
            self.assertEqual(runner.call_count,1)

    def test_quarantine_is_retained(self):
        pdf = self.root / 'tagged.pdf'; pdf.write_bytes(b'test')
        security.quarantine(pdf)
        first = subprocess.check_output(['/usr/bin/xattr','-p','com.apple.quarantine',str(pdf)])
        security.quarantine(pdf)
        self.assertEqual(first,subprocess.check_output(['/usr/bin/xattr','-p','com.apple.quarantine',str(pdf)]))

    def test_scanner_detects_harmless_standard_antivirus_test_pattern(self):
        # EICAR is an inert industry test pattern, never executed. Keep it out of project files.
        sample = self.root / 'antivirus-test.txt'
        sample.write_bytes(b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')
        with self.assertRaisesRegex(ValueError, 'Malware/suspicious-file alert'):
            security.assess(sample)


if __name__ == '__main__': unittest.main()
