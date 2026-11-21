import datetime,unittest
from zoneinfo import ZoneInfo
from scripts.market_map.cloud.regional_daily_supervisor import launch_hold,status_day

class SupervisorTests(unittest.TestCase):
 def setUp(self):
  self.local=datetime.datetime(2026,11,5,7,tzinfo=ZoneInfo('America/Toronto'))
  self.current={'run_day':'2026-11-05','state':'running'}
 def test_legacy_timestamp_uses_toronto_day(self):
  self.assertEqual(status_day({'started_at':'2026-11-05T01:14:00+00:00'}),'2026-11-04')
 def test_completed_pass_not_repeated_after_supervisor_restart(self):
  s={**self.current,'state':'completed_for_review'}
  self.assertEqual(launch_hold('source',None,s,s,self.local),'completed_for_review')
 def test_carrier_waits_for_new_source_status(self):
  old={'run_day':'2026-11-04','state':'completed_for_review'}
  self.assertEqual(launch_hold('carrier',None,old,old,self.local),'waiting_for_current_source_pass')
  self.assertIsNone(launch_hold('carrier',None,old,self.current,self.local))
 def test_current_day_paid_hold_survives_restart(self):
  for state in ['provider_error_hold','balance_reserve_hold','daily_lookup_cap']:
   self.assertEqual(launch_hold('carrier',None,{**self.current,'state':state},self.current,self.local),state)
 def test_next_day_selects_new_work(self):
  old={'run_day':'2026-11-04','state':'completed_for_review'}
  self.assertIsNone(launch_hold('source',None,old,old,self.local))
 def test_missing_status_cannot_trigger_unbounded_restarts(self):
  self.assertEqual(launch_hold('source',{'resume_count':3},{},{},self.local),'restart_limit_requires_review')
 def test_waits_for_start_and_inventory(self):
  self.assertEqual(launch_hold('source',None,{},{},self.local.replace(hour=6)),'waiting_for_07_00_Toronto')
  self.assertEqual(launch_hold('source',None,{},{},self.local,input_ready=False),'waiting_for_place_inventory')
 def test_carrier_waits_for_credentials(self):
  self.assertEqual(launch_hold('carrier',None,{},self.current,self.local,credentials=False),'credentials_missing')
if __name__=='__main__':unittest.main()
