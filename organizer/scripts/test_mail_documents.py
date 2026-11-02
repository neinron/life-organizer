import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from pypdf import PdfWriter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'lib'))
import mail_documents as m


class MailDocumentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.runtime = self.root / 'runtime'
        self.pdf = self.root / 'source.pdf'
        writer = PdfWriter(); writer.add_blank_page(width=100, height=100)
        writer.add_metadata({'/Title': 'Example paper research'}); writer.write(self.pdf)
        self.profile = {'mail_documents': {'enabled': True, 'routes': {
            'research_project': {'root': str(self.root / 'project'), 'rules': [
                {'senders': ['researcher@example.edu'], 'all_terms': ['example paper']}]}}}}
        self.message = {'account': 'tum', 'source_id': 'mail:INBOX:1:100',
                        'message_id': '<stable@example>', 'subject': 'Thesis papers',
                        'from': ['Researcher <researcher@example.edu>'], 'text': 'Example paper',
                        'attachments_complete': True, 'body_complete': True,
                        'metadata_attachments': [], 'attachments': [
                            {'name': 'paper.pdf', 'mime_type': 'application/pdf',
                             'size': self.pdf.stat().st_size, 'local_path': str(self.pdf)}]}

    def run_batch(self, message=None, apply=True):
        return m.process({'messages': [message or self.message]}, self.profile, self.runtime, apply)

    def record(self, report):
        return next(iter(report['messages'][0]['documents'].values()))

    def test_full_content_finds_attachment_despite_empty_listing_and_idempotency(self):
        preview = self.run_batch(apply=False)
        self.assertEqual(self.record(preview)['status'], 'planned')
        self.assertFalse(self.runtime.exists()); self.assertFalse((self.root / 'project').exists())
        result = self.run_batch(); self.assertTrue(result['ok']); self.assertEqual(result['changes'], 1)
        self.assertTrue(self.pdf.exists())
        self.assertEqual(self.run_batch()['changes'], 0)
        self.assertEqual(len(list((self.root / 'project').glob('*.pdf'))), 1)
        self.assertEqual(self.record(result)['pages'], 1)

    def test_incomplete_inventory_never_claimed_complete(self):
        for flag in ('attachments_complete', 'body_complete'):
            msg = {**self.message, flag: False}
            self.assertFalse(self.run_batch(msg)['ok'])

    def test_unknown_or_ambiguous_route_stays_open(self):
        msg = {**self.message, 'from': ['other@example.org']}
        self.assertEqual(self.record(self.run_batch(msg))['status'], 'open')
        self.profile['mail_documents']['routes']['other'] = copy.deepcopy(self.profile['mail_documents']['routes']['research_project'])
        self.assertFalse(self.run_batch()['ok'])
        self.assertFalse((self.root / 'project').exists())

    def test_hash_dedup_different_name_and_moved_mail(self):
        folder = self.root / 'project/sub'; folder.mkdir(parents=True)
        (folder / 'existing.PDF').write_bytes(self.pdf.read_bytes())
        self.assertEqual(self.run_batch()['changes'], 0)
        moved = {**self.message, 'source_id': 'mail:Archive:15:1'}
        self.assertEqual(self.run_batch(moved)['changes'], 0)
        state = json.loads((self.runtime / 'state/mail-documents.json').read_text())
        self.assertEqual(len(state['messages']), 1)

    def test_different_version_preserves_original(self):
        folder = self.root / 'project'; folder.mkdir()
        old = folder / 'paper.pdf'; old.write_bytes(b'existing different version')
        report = self.run_batch()
        self.assertTrue(report['ok']); self.assertEqual(old.read_bytes(), b'existing different version')
        self.assertNotEqual(self.record(report)['target'], str(old))

    def test_missing_link_and_same_arxiv_link_deduplicated(self):
        msg = {**self.message, 'text': 'Example paper https://arxiv.org/abs/2508.14119 and https://arxiv.org/pdf/2508.14119.pdf'}
        report = self.run_batch(msg)
        self.assertEqual(len(report['messages'][0]['documents']), 2)
        self.assertFalse(report['ok'])
        msg['link_artifacts'] = {'https://arxiv.org/pdf/2508.14119': {'local_path': str(self.pdf)}}
        self.assertTrue(self.run_batch(msg)['ok'])

    def test_corrupt_truncated_wrong_size_and_wrong_hash(self):
        for patch in ({'size': 1}, {'sha256': '0'*64}, {'r2_key': 'files/'+'0'*40}):
            msg = copy.deepcopy(self.message); msg['attachments'][0].update(patch)
            self.assertFalse(self.run_batch(msg)['ok'])
        self.pdf.write_bytes(b'%PDF-1.7\ntruncated')
        self.message['attachments'][0].pop('size')
        self.assertFalse(self.run_batch()['ok'])

    def test_destination_tampering_detected_and_original_can_be_restored(self):
        result = self.run_batch()
        target = Path(self.record(result)['target']); target.write_bytes(b'user changed original')
        state = json.loads((self.runtime / 'state/mail-documents.json').read_text())
        self.assertEqual(m.audit(state)[0]['status'], 'missing_or_changed')
        # Changed user copy survives; original is restored under a distinct hash name.
        self.assertTrue(self.run_batch()['ok'])
        self.assertEqual(target.read_bytes(), b'user changed original')

    def test_symlink_and_traversal_are_refused(self):
        alias = self.root / 'alias.pdf'; alias.symlink_to(self.pdf)
        msg = copy.deepcopy(self.message); msg['attachments'][0]['local_path'] = str(alias)
        self.assertFalse(self.run_batch(msg)['ok'])
        msg = copy.deepcopy(self.message); msg['attachments'][0]['name'] = '../escape.pdf'
        self.assertFalse(self.run_batch(msg)['ok'])
        self.assertFalse((self.root / 'escape.pdf').exists())

    def test_exclusions_and_challenges_cannot_be_overridden(self):
        for patch in ({'excluded': True}, {'challenge': True}, {'subject': 'Data Driven Innovation'}):
            msg = {**self.message, **patch, 'route_id': 'research_project', 'routing_reason': 'test'}
            self.assertFalse(self.run_batch(msg)['ok'])

    def test_resume_using_staged_bytes(self):
        self.run_batch()
        target = self.root / 'project/paper.pdf'; target.unlink(); self.pdf.unlink()
        msg = copy.deepcopy(self.message); msg['attachments'][0].pop('local_path')
        self.assertTrue(self.run_batch(msg)['ok']); self.assertTrue(target.exists())

    def test_public_fetch_rejects_private_hosts_credentials_and_redirects(self):
        spec = importlib.util.spec_from_file_location('fetch_pdf', ROOT / 'scripts/fetch-mail-pdf.py')
        f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
        for url in ('https://localhost/a.pdf', 'http://arxiv.org/a.pdf', 'https://arxiv.org@evil.example/a.pdf',
                    'https://user:pass@arxiv.org/a.pdf', 'https://arxiv.org/a.pdf?token=x', 'https://arxiv.org:444/a.pdf'):
            with self.subTest(url=url), self.assertRaises(ValueError): f.allowed(url, ['arxiv.org'])


if __name__ == '__main__': unittest.main()
