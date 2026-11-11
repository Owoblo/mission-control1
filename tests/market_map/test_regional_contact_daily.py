import hashlib,json,tempfile,unittest
from pathlib import Path
from scripts.market_map.cloud.regional_contact_enrichment import daily_plan,group_inputs

class RegionalDailyTests(unittest.TestCase):
 def test_city_priority_and_directory_exclusion(self):
  rows=[{'website':u,'municipality':c,'category':k} for u,c,k in [('https://lasalle.test','LaSalle','accountant'),('https://windsor-a.test','Windsor','accountant'),('https://windsor-b.test','Windsor','accountant'),('https://windsor-c.test','Windsor','restaurant'),('https://facebook.com/x','Windsor','accountant')]]
  groups=group_inputs(rows)
  self.assertEqual([g['host'] for g in groups],['windsor-a.test','windsor-c.test','windsor-b.test','lasalle.test'])
 def test_day_scope_survives_restart_and_next_day_skips_captured(self):
  with tempfile.TemporaryDirectory() as d:
   out=Path(d);groups=[{'host':h} for h in ['a.test','b.test','c.test']]
   first=daily_plan(groups,out,'2026-11-04',2)
   for h in first['hosts']:
    p=out/'sources'/hashlib.sha256(h.encode()).hexdigest()[:20];p.mkdir(parents=True);(p/'receipt.json').write_text('{}')
   self.assertEqual(daily_plan(groups,out,'2026-11-04',2),first)
   self.assertEqual(daily_plan(groups,out,'2026-11-05',2)['hosts'],['c.test'])
   with self.assertRaises(ValueError):daily_plan(groups,out,'2026-11-04',3)
 def test_adopts_original_pass_without_silent_scope_change(self):
  with tempfile.TemporaryDirectory() as d:
   groups=[{'host':'new-order.test'},{'host':'original.test'}]
   self.assertEqual(daily_plan(groups,Path(d),'2026-11-04',1,[groups[1]])['hosts'],['original.test'])

if __name__=='__main__':unittest.main()
