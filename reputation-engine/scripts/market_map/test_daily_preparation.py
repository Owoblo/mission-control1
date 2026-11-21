import tempfile,unittest,ast
from datetime import datetime,timezone
from pathlib import Path
from .daily_preparation import Ledger,identity,next_due
class DailyPreparationTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.l=Ledger(Path(self.tmp.name)/'ledger.db')
 def tearDown(self):self.l.db.close();self.tmp.cleanup()
 def records(self):return [{'organization':f'{city} {cat} {n}','address':str(n)+' Main Road','municipality':city,'category':cat,'website':'https://shared.example'}for city in ['Windsor','Tecumseh','LaSalle']for cat in ['clinic','shop']for n in range(4)]
 def test_persistent_city_category_rotation(self):
  self.l.seed(self.records());a=self.l.plan('2026-11-18',6);self.assertEqual(set(a['city_distribution'].values()),{2});self.assertEqual(a['category_count'],6)
  self.l.db.close();self.l=Ledger(Path(self.tmp.name)/'ledger.db');b=self.l.plan('2026-11-19',6);self.assertFalse({x['id']for x in a['items']}&{x['id']for x in b['items']})
 def test_same_day_replay_does_not_reselect(self):
  self.l.seed(self.records());a=self.l.plan('2026-11-18',5);self.assertEqual(a,self.l.plan('2026-11-18',50));self.assertEqual(sum(self.l.summary()['city_selection'].values()),5)
 def test_shared_domain_not_entity_merge(self):self.l.seed(self.records());self.assertEqual(self.l.summary()['total'],24)
 def test_source_update_preserves_completed_state(self):
  r=self.records()[0];self.l.seed([r]);p=self.l.plan('day',1);self.l.finish_item(p['items'][0]['id'],'prepared_review');self.l.seed([{**r,'website':'https://changed.example'}]);self.assertEqual(self.l.summary()['states'],{'prepared_review':1})
 def test_non_business_context_retained_not_selected(self):
  self.l.seed([{'organization':'Park','address':'1 Main','municipality':'Windsor','category':'park'}]);self.assertEqual(self.l.plan('day',5)['items'],[]);self.assertEqual(self.l.summary()['states'],{'context_only':1})
 def test_no_approval_or_send_states(self):
  with self.assertRaises(ValueError):self.l.finish_item('x','send_ready')
 def test_toronto_dst_aware_schedule(self):
  self.assertEqual(next_due(datetime(2026,11,18,11,tzinfo=timezone.utc)).hour,12)
  self.assertEqual(next_due(datetime(2026,7,18,10,tzinfo=timezone.utc)).hour,11)
 def test_exact_business_branch_keys(self):
  r=self.records()[0];self.assertNotEqual(identity(r),identity({**r,'address':'5 Main Road'}))
class FinalReportTests(unittest.TestCase):
 def test_missing_carrier_receipt_remains_held_and_day_is_preserved(self):
  source=Path(__file__).with_name('daily_preparation_worker.py').read_text();node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)and n.name=='finalize_items');saved={}
  fixtures={'mailbox-checks.json':{'phones':{'+15195550123':{'receipt':None}}},'crm-context.json':{'accounts':[]}}
  scope={'read':lambda path,default=None:fixtures.get(path.name,default),'save':lambda path,value:saved.update({str(path):value}),'stamp':lambda:'now'}
  exec(compile(ast.Module(body=[node],type_ignores=[]),'finalize','exec'),scope)
  item={'id':'one','routes':[{'type':'phone','value':'+15195550123'}],'draft':{'body':'preserved'}}
  items,_,_=scope['finalize_items'](Path('/tmp/2026-11-18'),[item])
  self.assertIsNone(items[0]['proposed_channel']);self.assertIn('selected_channel_route_unresolved',items[0]['holds']);self.assertEqual(items[0]['draft']['body'],'preserved');self.assertEqual(saved['/tmp/2026-11-18/review-queue.json']['day'],'2026-11-18')
class HumanReviewPreservationTests(unittest.TestCase):
 def test_explicit_reviewed_route_and_material_holds_survive_finalization(self):
  source=Path(__file__).with_name('daily_preparation_worker.py').read_text();node=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef)and n.name=='finalize_items');scope={'read':lambda p,d=None:{},'save':lambda p,d:None,'stamp':lambda:'now'};exec(compile(ast.Module(body=[node],type_ignores=[]),'finalize','exec'),scope)
  item={'id':'one','routes':[{'type':'email','value':'ceo@example.com'},{'type':'email','value':'admin@example.com'}],'draft':{'body':'reviewed'},'proposed_recipient':'admin@example.com','proposed_channel':'email','copy_review_status':'operator_reviewed_release_holds_retained','holds':['address_conflict']}
  result,_,_=scope['finalize_items'](Path('/tmp/2026-11-18'),[item]);self.assertEqual(result[0]['proposed_recipient'],'admin@example.com');self.assertIn('address_conflict',result[0]['holds']);self.assertEqual(result[0]['draft']['body'],'reviewed')
if __name__=='__main__':unittest.main()
