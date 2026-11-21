import unittest
from scripts.procurement.canadabuys_partner_intake import parse
class IntakeTests(unittest.TestCase):
 def fixture(self):return b'''Partner with another business Businesses interested in partnering for this tender opportunity: <a href="/en/node/preview/1">Pro Multi-Services Inc.</a><a href="/en/node/preview/2">Pro Multi-Services Inc.</a><a href="/en/node/preview/3">Saturn Star Movers</a> Contact information <a href="/en/node/preview/4">Unrelated</a>'''
 def test_preserves_distinct_profiles_without_award_inference(self):
  rows=parse(self.fixture(),'2026-10-28');self.assertEqual(len(rows),3);self.assertTrue(rows[0]['duplicate_name_review']);self.assertTrue(rows[2]['is_own_business']);self.assertTrue(all(r['award_status']=='unknown' and not r['campaign_ready'] for r in rows))
 def test_missing_section_fails_closed(self):
  with self.assertRaises(ValueError):parse(b'<a href="/en/node/preview/1">Example</a>','now')
 def test_deterministic_ids(self):self.assertEqual([r['id'] for r in parse(self.fixture(),'a')],[r['id'] for r in parse(self.fixture(),'b')])
if __name__=='__main__':unittest.main()
