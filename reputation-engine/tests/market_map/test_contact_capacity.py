import datetime,unittest
from zoneinfo import ZoneInfo
from scripts.market_map.cloud.contact_capacity import capacity
from scripts.market_map.cloud.regional_daily_supervisor import launch_hold
class CapacityTests(unittest.TestCase):
 def test_original_limits_remain_default(self):
  self.assertEqual(capacity({}),{'domains':1000,'workers':4,'bytes':500000000,'lookups':1000,'start_hour':7})
 def test_explicit_expanded_capacity(self):
  d=capacity({'REGIONAL_DOMAIN_DAILY_CAP':'6000','REGIONAL_SOURCE_WORKERS':'8','REGIONAL_SOURCE_BYTE_CAP':'3000000000','REGIONAL_CARRIER_DAILY_CAP':'2500','REGIONAL_RESEARCH_START_HOUR':'0'})
  self.assertEqual(d['domains'],6000);self.assertEqual(d['lookups'],2500)
  self.assertIsNone(launch_hold('source',None,{},{},datetime.datetime(2026,11,5,2,tzinfo=ZoneInfo('America/Toronto')),start_hour=d['start_hour']))
 def test_invalid_budgets_fail_closed(self):
  for env in [{'REGIONAL_DOMAIN_DAILY_CAP':'0'},{'REGIONAL_SOURCE_WORKERS':'99'},{'REGIONAL_CARRIER_DAILY_CAP':'2501'},{'REGIONAL_SOURCE_BYTE_CAP':'bad'},{'REGIONAL_RESEARCH_START_HOUR':'24'}]:
   with self.assertRaises(ValueError):capacity(env)
if __name__=='__main__':unittest.main()
