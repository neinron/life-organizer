import hashlib, importlib.util, tempfile, unittest
from datetime import datetime
from pathlib import Path
spec=importlib.util.spec_from_file_location('sync_files',Path(__file__).with_name('sync-files.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name); self.stage=self.root/'staging'; self.stage.mkdir()
        (self.stage/'x.pdf').write_bytes(b'new course file')
        self.profile={'study_root':str(self.root/'study'),'semester_folder':'5. Semester','courses':[{'key':'ase','folder':'ASE'}]}
        self.item={'course':'ase','name':'x.pdf','staged_path':'x.pdf','category':'Vorlesungen','sha256':hashlib.sha256(b'new course file').hexdigest()}
    def test_quiet_hours_boundaries_and_dst(self):
        profile={**self.profile,'quiet_hours':{'timezone':'Europe/Berlin','start':'23:00','end':'06:00'}}
        for stamp,quiet in [('2026-12-01T21:59:59+00:00',False),('2026-12-01T22:00:00+00:00',True),('2026-12-02T04:59:59+00:00',True),('2026-12-02T05:00:00+00:00',False),('2026-07-01T21:00:00+00:00',True),('2026-07-02T04:00:00+00:00',False),('2026-10-25T01:30:00+00:00',True)]:
            with self.subTest(stamp=stamp): self.assertEqual(m.is_quiet_hours(profile,datetime.fromisoformat(stamp)),quiet)
    def test_dry_run_and_idempotency(self):
        self.assertEqual(m.sync_one(self.item,self.profile,self.stage)['status'],'planned')
        self.assertFalse((self.root/'study').exists())
        result=m.sync_one(self.item,self.profile,self.stage,True)
        self.assertEqual(result['status'],'copied')
        self.assertEqual(m.sync_one(self.item,self.profile,self.stage,True)['status'],'already_present')
        self.assertTrue((self.stage/'x.pdf').exists())
    def test_disabled_quiet_hours_allow_night_sync(self):
        profile={**self.profile,'quiet_hours':{'enabled':False,'timezone':'Europe/Berlin','start':'23:00','end':'06:00'}}
        for stamp in ['2026-12-01T22:00:00+00:00','2026-07-01T21:00:00+00:00','2026-10-25T01:30:00+00:00']:
            with self.subTest(stamp=stamp): self.assertFalse(m.is_quiet_hours(profile,datetime.fromisoformat(stamp)))
    def test_conflict_preserves_old_file(self):
        d=self.root/'study/5. Semester/ASE/Vorlesungen'; d.mkdir(parents=True); (d/'x.pdf').write_bytes(b'old')
        result=m.sync_one(self.item,self.profile,self.stage,True)
        self.assertEqual((d/'x.pdf').read_bytes(),b'old'); self.assertNotEqual(Path(result['target']).name,'x.pdf')
    def test_authorized_challenge_is_copied_as_opaque_file(self):
        profile={**self.profile,'courses':[{'key':'netsec','folder':'Network Security'}],
                 'systems':{'netsec_challenges':{'authorized_download_ids':['pwn02_01']}}}
        item={**self.item,'course':'netsec','category':'Hacking Challenges','challenge':True,
              'challenge_id':'pwn02_01','source_url':'https://netsec.net.in.tum.de/tasks/2',
              'name':'pwn02_01.zip'}
        self.assertEqual(m.sync_one(item,profile,self.stage)['status'],'planned')
        result=m.sync_one(item,profile,self.stage,True)
        self.assertEqual(Path(result['target']).read_bytes(),b'new course file')
        self.assertEqual(m.sync_one(item,profile,self.stage,True)['status'],'already_present')
        for patch in [{'challenge_id':'pwn99_01'},{'course':'ase'},
                      {'source_url':'https://evil.example/tasks/2'},
                      {'source_url':'https://netsec.net.in.tum.de.evil.example/tasks/2'},
                      {'source_url':'http://netsec.net.in.tum.de/tasks/2'},
                      {'category':'Vorlesungen'},{'challenge':False}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError):
                m.sync_one({**item,**patch},profile,self.stage)
    def test_untrusted_paths_hashes_and_symlinks(self):
        for patch in [{'name':'../x.pdf'},{'staged_path':'../x.pdf'},{'sha256':'incorrect'},{'course':'unknown'},{'category':'../escape'},{'challenge':True}]:
            with self.subTest(patch=patch),self.assertRaises(ValueError): m.sync_one({**self.item,**patch},self.profile,self.stage,True)
        (self.stage/'link.pdf').symlink_to(self.stage/'x.pdf')
        with self.assertRaises(ValueError): m.sync_one({**self.item,'staged_path':'link.pdf'},self.profile,self.stage,True)

if __name__=='__main__': unittest.main()
