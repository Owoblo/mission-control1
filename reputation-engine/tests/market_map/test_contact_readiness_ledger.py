import unittest
from scripts.market_map.contact_readiness_ledger import ContactLedger
class LedgerTests(unittest.TestCase):
 def setUp(self):self.l=ContactLedger(':memory:')
 def tearDown(self):self.l.close()
 def test_same_contact_two_channels_and_followup_count_once(self):
  self.l.register('a','org','person',[('sms','+15195550123'),('email','a@example.test')])
  for key,ch,at in [('sms1','sms','2026-11-05T15:00:00Z'),('email1','email','2026-11-05T15:05:00Z'),('follow','email','2026-11-06T15:00:00Z')]:self.l.event(key,'a','provider_accepted',ch,at,{'receipt':key})
  self.assertEqual(self.l.scorecard('2026-11-05')['new_unique_contacts_provider_accepted'],1)
  self.assertEqual(self.l.scorecard('2026-11-05')['stages']['provider_accepted'],1)
  self.assertEqual(self.l.scorecard('2026-11-06')['new_unique_contacts_provider_accepted'],0)
  self.assertEqual(self.l.scorecard('2026-11-05')['stages']['delivered'],0)
  self.assertEqual(self.l.scorecard('2026-11-05')['new_verified_unique_contacts_provider_accepted'],0)
 def test_shared_route_is_held_not_double_counted(self):
  for c in ['a','b']:
   self.l.register(c,'org','person',[('email','shared@example.test')]);self.l.event(c,c,'verified','email','2026-11-05T15:00:00Z',{'source':'fixture'})
  self.assertEqual(self.l.scorecard('2026-11-05')['stages']['verified'],0)
  self.assertEqual(self.l.scorecard('2026-11-05')['identity_conflicts_excluded'],2)
 def test_event_replay_and_toronto_day(self):
  self.l.register('a','org','business_route',[('phone','+15195550123')])
  for _ in range(2):self.l.event('q','a','queued','sms','2026-11-05T02:00:00Z',{'job':'one'})
  self.assertEqual(self.l.scorecard('2026-11-04')['stages']['queued'],1)
  with self.assertRaises(ValueError):self.l.event('q','a','queued','sms','2026-11-05T02:00:00Z',{'job':'different'})
 def test_formatted_phone_and_sms_are_one_alias(self):
  self.l.register('a','org','person',[('phone','(519) 555-0123')])
  self.l.register('b','org','person',[('sms','+15195550123')])
  self.assertEqual(self.l.scorecard('2026-11-05')['identity_conflicts_excluded'],2)
 def test_verified_send_counts_once(self):
  self.l.register('a','org','business_route',[('sms','5195550123')])
  self.l.event('v','a','verified','sms','2026-11-05T09:00:00-05:00',{'check':'fixture'})
  self.l.event('s','a','provider_accepted','sms','2026-11-05T15:00:00Z',{'receipt':'fixture'})
  self.assertEqual(self.l.scorecard('2026-11-05')['new_verified_unique_contacts_provider_accepted'],1)
if __name__=='__main__':unittest.main()
