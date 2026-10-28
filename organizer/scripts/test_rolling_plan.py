import importlib.util, unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('rolling',Path(__file__).with_name('plan-rolling-tasks.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def task(id,status,start,end,due=None):
    return {'id':id,'properties':{'Name':{'type':'title','title':[{'plain_text':id}]},'Status':{'type':'status','status':{'name':status}},'Course':{'type':'relation','relation':[{'id':'active'}]},'Registration':{'checkbox':True},'Do Date':{'type':'date','date':{'start':start,'end':end}},'Due Date':{'type':'date','date':{'start':due} if due else None}}}

class RollingTests(unittest.TestCase):
    def inputs(self):
        data={'has_more':False,'results':[
            task('past','not started','2026-10-27T08:30:00+01:00','2026-10-27T09:30:00+01:00'),
            task('deadline','not started','2026-10-29T08:30:00+01:00','2026-10-29T09:30:00+01:00','2026-10-30T14:00:00+01:00'),
            task('running','in progress','2026-10-28T10:30:00+01:00','2026-10-28T11:30:00+01:00'),
            task('done','done','2026-10-27T09:30:00+01:00','2026-10-27T10:30:00+01:00')]}
        fb={'timeMin':'2026-10-28T11:00:00+01:00','timeMax':'2026-11-25T21:30:00+01:00','calendars':{m.TASK_CAL:{'busy':[]},'other':{'busy':[]}}}
        profile={'courses':[{'notion_id':'active','plan_work':True}],'planning':{'work_start':'08:30','general_task_ids':[],'deferred_task_ids':{},'task_durations':{'past':{'minutes':60}},'earliest_start':{},'daily_work_minutes':240}}
        return data,fb,{'items':[]},profile,m.p.parse_dt('2026-10-28T11:00:00+01:00')
    def test_preserves_running_completed_and_future_deadline(self):
        r=m.plan(*self.inputs());self.assertTrue(r['ok']);self.assertEqual([x['id'] for x in r['moves']],['past']);self.assertGreaterEqual(m.p.parse_dt(r['moves'][0]['new_start']),m.p.parse_dt('2026-10-28T11:45:00+01:00'))
    def test_no_reflow_without_missed_task(self):
        args=list(self.inputs());args[0]['results']=args[0]['results'][1:];r=m.plan(*args);self.assertEqual(r['moves'],[])
    def test_unfinished_time_window_does_not_trigger_early_reflow(self):
        args=list(self.inputs());args[0]['results'][0]['properties']['Do Date']['date']={'start':'2026-10-28T10:30:00+01:00','end':'2026-10-28T12:00:00+01:00'};r=m.plan(*args);self.assertEqual(r['moves'],[])
    def test_unknown_calendar_event_stays_reserved(self):
        args=list(self.inputs());args[2]['items']=[{'id':'manual','description':'Manual block','start':{'dateTime':'2026-10-28T11:45:00+01:00'},'end':{'dateTime':'2026-10-28T12:45:00+01:00'}}];r=m.plan(*args);self.assertTrue(r['ok']);self.assertGreaterEqual(m.p.parse_dt(r['moves'][0]['new_start']),m.p.parse_dt('2026-10-28T13:00:00+01:00'))
    def test_past_deadline_is_not_silently_planned_late(self):
        args=list(self.inputs());args[0]['results'][0]['properties']['Due Date']['date']={'start':'2026-10-27T14:00:00+01:00'};r=m.plan(*args);self.assertFalse(r['ok']);self.assertTrue(r['unplaced']);self.assertEqual(r['moves'],[])
    def test_fixed_task_does_not_trigger_reflow(self):
        args=list(self.inputs());args[0]['results'][0]['properties']['Fixiert']={'checkbox':True};self.assertEqual(m.plan(*args)['moves'],[])
    def test_new_personal_task_ignores_academic_registration(self):
        args=list(self.inputs());t=args[0]['results'][0];t['properties']['Course']['relation']=[];t['properties']['Registration']['checkbox']=False;t['created_time']='2026-10-28T10:00:00Z';t['properties']['Do Date']['date']=None
        args[3]['planning']['personal']={'enabled':True,'standalone_created_since':'2026-10-28'}
        r=m.plan(*args);self.assertTrue(r['ok']);self.assertEqual(r['moves'][0]['id'],'past')
    def test_same_course_lecture_can_use_imported_lecture_slot(self):
        args=list(self.inputs());args[0]['results']=args[0]['results'][:1];t=args[0]['results'][0];t['properties']['Type']={'type':'select','select':{'name':'Lecture'}}
        args[3]['courses'][0]['name']='Example Course';args[3]['calendars']={'tum_import':'tum'};args[3]['planning']['reusable_work_blocks']={'enabled':True}
        args[1]['calendars']['tum']={'busy':[{'start':'2026-10-28T11:00:00+01:00','end':'2026-10-28T12:00:00+01:00'}]}
        details={'tum':{'items':[{'id':'lecture','summary':'Example Course VO','start':{'dateTime':'2026-10-28T11:00:00+01:00'},'end':{'dateTime':'2026-10-28T12:00:00+01:00'}}]}}
        r=m.plan(*args,details);self.assertTrue(r['ok']);self.assertEqual(r['moves'][0]['new_start'],'2026-10-28T11:00:00+01:00')

if __name__=='__main__':unittest.main()
