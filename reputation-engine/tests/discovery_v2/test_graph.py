import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/discovery_v2'))
from engine import Engine
from graph import materialize,audit
class GraphTests(unittest.TestCase):
 def test_conflicting_statements_survive_and_backfill_is_idempotent(self):
  e=Engine(':memory:');base={'name':'First Name','source_url':'https://example.test/1','city':'Town','address':'1 Main St','website':'https://company.test'}
  for name in ['First Name','New Name']:e.ingest(source='a',family='directory',scope='town',category='*',rows=[{**base,'name':name}])
  self.assertGreater(materialize(e),0);self.assertEqual(materialize(e),0);values=[r[0] for r in e.db.execute("SELECT value_json FROM statements WHERE predicate='name_observed'")];self.assertEqual(set(values),{'"First Name"','"New Name"'});self.assertEqual(e.db.execute('SELECT COUNT(*) FROM statements WHERE valid_at IS NOT NULL').fetchone()[0],0)
  r=audit(e,{'cells':[{'scope':'town','category':'*'}],'families':['directory','registry']});self.assertIn('identity_conflicts',[f['kind'] for f in r['findings']]);self.assertEqual(r['discovery_curves'][-1]['cumulative_observed'],1)
 def test_enrichment_does_not_create_discovery_curve(self):
  e=Engine(':memory:');e.ingest(source='a',family='website',scope='town',category='*',kind='enrichment',rows=[{'name':'Company','source_url':'https://example.test'}]);materialize(e);r=audit(e,{'cells':[{'scope':'town','category':'*'}],'families':['directory']});self.assertEqual(r['discovery_curves'],[])
if __name__=='__main__':unittest.main()
