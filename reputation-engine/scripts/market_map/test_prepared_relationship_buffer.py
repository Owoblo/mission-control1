import copy,tempfile,unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from .prepared_relationship_buffer import Buffer,build,relationship_action,CARD_NAMES,next_business_window,dt

NOW=datetime(2026,11,18,16,tzinfo=timezone.utc)
def record(reply='Sure',offer='Would you like a digital card?',cid='5f14e307-79b1-442a-b81c-91e6551a58c8'):
 return {'contact':{'id':cid,'name':'Izabella Bauer','city':'Burlington','phone':'+19055550123'},'history':[{'id':'a','created_at':'2026-10-01T12:00:00Z','direction':'outbound','channel':'sms','notes':'John, Saturn Star Movers. '+offer,'metadata':{'from':'+14374650584'}},{'id':'b','created_at':'2026-10-01T12:01:00Z','direction':'inbound','channel':'sms','notes':reply,'metadata':{'to':'+14374650584'}}],'tasks':[]}

class PreparedBufferTests(unittest.TestCase):
 def test_card_offer_has_contextual_draft_not_visit(self):
  r=relationship_action(record(),NOW);self.assertEqual(r['kind'],'requested_card_fulfilment');self.assertIn('Burlington card, Izabella',r['body']);self.assertFalse(r['send_ready']);self.assertFalse(r['scheduled'])
 def test_yes_to_physical_offer_is_owner_review(self):
  r=relationship_action(record('Sure','May I stop by your office?'),NOW);self.assertEqual(r['kind'],'owner_meeting_review');self.assertIsNone(r['body'])
 def test_new_no_invalidates_saved_card_permission(self):
  x=record('No thanks');r=relationship_action(x,NOW);self.assertEqual(r['kind'],'decline_review');self.assertIsNone(r['body'])
 def test_followup_question_not_hidden_by_thanks(self):
  r=relationship_action(record('Thanks, where are you located?'),NOW);self.assertEqual(r['kind'],'specific_request_context_review');self.assertIsNone(r['body'])
 def test_typo_correction_keeps_earlier_request_context(self):
  x=record('Sure thing John. Send it ovet',cid='a1c500b5-8311-41d8-aaa4-d93538ed1adf');x['history'].append({'id':'c','created_at':'2026-10-01T12:01:01Z','direction':'inbound','channel':'sms','notes':'*over','metadata':{'to':'+14374650584'}});self.assertEqual(relationship_action(x,NOW)['kind'],'requested_card_fulfilment')
 def test_quiet_relationship_is_future_review_without_copy(self):
  r=relationship_action(record('Nothing now, maybe next year',cid='other'),NOW);self.assertEqual(r['kind'],'quiet_relationship_review');self.assertGreaterEqual(dt(r['not_before']),datetime(2027,1,1,tzinfo=timezone.utc));self.assertIsNone(r['body'])
 def test_shared_route_is_held_not_merged(self):
  a=record();b=record(cid=next(k for k in CARD_NAMES if k!=a['contact']['id']));p=build({'priority_review':[a,b]}, {'items':[]},{'items':[]},NOW);self.assertEqual(len(p['items']),2);self.assertTrue(all('shared_recipient_account_coordination_review'in r['holds']for r in p['items']))
 def test_every_source_review_has_disposition(self):
  p=build({'priority_review':[record(),record('Nope',cid='other')]},{'items':[]},{'items':[]},NOW);self.assertEqual(p['summary']['source_review_records'],2);self.assertEqual(len(p['review_dispositions']),2)
 def test_same_source_does_not_push_prepared_window_forward(self):
  with tempfile.TemporaryDirectory()as tmp:
   db=Buffer(Path(tmp)/'ledger.sqlite');p=build({'priority_review':[record()]},{'items':[]},{'items':[]},NOW);db.save(p);when=p['items'][0]['not_before'];q=build({'priority_review':[record()]},{'items':[]},{'items':[]},NOW+timedelta(days=2));db.save(q);self.assertEqual(q['items'][0]['not_before'],when);db.db.close()
 def test_changed_reply_archives_old_copy(self):
  with tempfile.TemporaryDirectory()as tmp:
   db=Buffer(Path(tmp)/'ledger.sqlite');p=build({'priority_review':[record()]},{'items':[]},{'items':[]},NOW);db.save(p);q=build({'priority_review':[record('No thanks')]},{'items':[]},{'items':[]},NOW);db.save(q);self.assertIsNone(q['items'][0]['body']);self.assertEqual(db.db.execute('SELECT count(*)FROM versions').fetchone()[0],1);db.db.close()
 def test_no_reintroduction_for_another_brand(self):
  x=record();x['history'][0]['notes']='Courage from Dexa Movers. Would you like a digital card?';self.assertIsNone(relationship_action(x,NOW)['body'])
 def test_iso_variable_precision(self):self.assertEqual(dt('2026-11-17T19:28:11.59+00:00').microsecond,590000)
 def test_friday_preparation_window_skips_weekend(self):self.assertEqual(next_business_window(datetime(2026,11,20,16,tzinfo=timezone.utc)).weekday(),0)

if __name__=='__main__':unittest.main()
