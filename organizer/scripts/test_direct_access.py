import importlib.util,json,os,tempfile,unittest
from pathlib import Path
from datetime import datetime,timezone,timedelta
def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
n=module('normalizer','normalize-notion.py');c=module('localcal','local-calendars.py');l=module('lease','lease.py')
class DirectAccessTests(unittest.TestCase):
 def row(self):return {'url':'https://app.notion.com/p/11111111111141118111111111111111','Name':'Task','Status':'not started','Course':'[]','Fixiert':'__YES__','Created time':'2026-10-28T10:00:00Z','date:Do Date:start':'2026-10-28T11:00:00Z','date:Do Date:end':'2026-10-28T12:00:00Z'}
 def test_normalizer_emits_typed_properties(self):
  r=n.normalize([{'results':[self.row()],'has_more':False}],{})['results'][0];self.assertEqual(r['properties']['Do Date']['type'],'date');self.assertTrue(r['properties']['Fixiert']['checkbox']);self.assertFalse(r['properties']['Registration']['checkbox'])
 def test_rejects_partial_snapshot(self):
  with self.assertRaises(ValueError):n.normalize([{'results':[self.row()],'has_more':True}],{})
 def test_rejects_duplicate_pages(self):
  with self.assertRaises(ValueError):n.normalize([{'results':[self.row()],'has_more':True,'next_cursor':'x'},{'results':[self.row()],'has_more':False}],{})
 def inputs(self):
  now=datetime.now(timezone.utc);start=now.isoformat();end=(now+timedelta(days=28)).isoformat();return {'timeMin':start,'timeMax':end,'calendars':{'google':{'busy':[]}}},{'ok':True,'complete':True,'timeMin':start,'timeMax':end,'checked_at':start,'calendars':[{'id':'exchange'}],'events':[{'calendar_id':'exchange','start':start,'end':(now+timedelta(hours=1)).isoformat(),'busy':True}]}
 def test_native_calendar_protects_time(self):
  fb,s=self.inputs();r=c.merge_native(fb,s,['exchange']);self.assertEqual(len(r['calendars']['apple:exchange']['busy']),1);self.assertNotIn('apple:exchange',fb['calendars'])
 def test_stale_native_is_not_free_time(self):
  fb,s=self.inputs();s['checked_at']=(datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
  with self.assertRaises(ValueError):c.merge_native(fb,s,['exchange'])
 def test_missing_calendar_rejected(self):
  fb,s=self.inputs()
  with self.assertRaises(ValueError):c.merge_native(fb,s,['other'])
 def test_active_and_unknown_leases_preserved(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'lease.json';self.assertTrue(l.acquire(p,'one',os.getpid()));self.assertFalse(l.acquire(p,'two',recover_dead=True));l.release(p,'one');self.assertTrue(l.acquire(p,'agent'));self.assertFalse(l.acquire(p,'two',recover_dead=True))
 def test_dead_pid_can_be_recovered_and_audited(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'lease.json';p.write_text(json.dumps({'owner':'crashed','pid':99999999}));self.assertTrue(l.acquire(p,'new',os.getpid(),True));self.assertTrue(p.with_name('lease-recovery.jsonl').exists())
if __name__=='__main__':unittest.main()
