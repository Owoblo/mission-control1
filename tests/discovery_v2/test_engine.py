import sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts/discovery_v2'))
from engine import Engine
class EngineTests(unittest.TestCase):
 def setUp(self):self.e=Engine(':memory:')
 def row(self,url='https://directory.test/1',**kw):return {'name':'Example Company','source_url':url,'source_url_is_record':True,'city':'London','address':'12 Test Street','website':'https://example.test','categories':'Consulting',**kw}
 def ingest(self,rows,source='A',**kw):return self.e.ingest(source=source,family=source,scope='region',category='*',rows=rows,**kw)
 def test_replay_does_not_inflate(self):
  r=self.ingest([self.row()]);again=self.ingest([self.row()]);self.assertTrue(again['replayed']);self.assertEqual(self.e.db.execute('select count(*) from runs').fetchone()[0],1)
 def test_cross_source_overlap_and_site_separation(self):
  self.ingest([self.row()]);r=self.ingest([self.row('https://other.test/1'),self.row('https://other.test/2',address='90 Other Street')],source='B');self.assertEqual((r['new_entities'],r['overlap_entities']),(1,1))
 def test_shared_domain_does_not_merge_brands(self):
  self.ingest([self.row()]);r=self.ingest([self.row('https://other.test',name='Another Brand')],source='B');self.assertEqual(r['new_entities'],1)
 def test_conflicting_source_identity_is_not_overwritten(self):
  self.ingest([self.row()]);r=self.ingest([self.row(name='Changed Name')]);self.assertEqual(r['conflicts'],1);eid=self.e.db.execute('select id from entities').fetchone()[0];self.assertEqual(self.e.confidence(eid)['organization_identity']['status'],'conflicting');self.assertEqual(self.e.confidence(eid)['email_deliverability']['status'],'uncertain')
 def test_enrichment_cannot_fill_discovery_coverage(self):
  self.ingest([self.row()],kind='enrichment');p=self.e.plan([{'scope':'region','category':'*'}],['A']);self.assertEqual(p['coverage'][0]['missing_families'],['A'])
 def test_broad_directory_cannot_fill_niche_cell(self):
  self.ingest([self.row()]);p=self.e.plan([{'scope':'region','category':'Architecture'}],['A']);self.assertEqual(p['coverage'][0]['missing_families'],['A'])
 def test_duplicate_rows_and_missing_fields(self):
  r=self.ingest([self.row(),self.row(),{'name':'broken'}]);self.assertEqual((r['distinct_entities'],r['invalid_rows']),(1,1))
 def test_unsearched_family_rank_and_replay_preserves_task_status(self):
  self.ingest([self.row()]);cell=[{'scope':'region','category':'*'}];p=self.e.plan(cell,['A','B']);self.assertEqual(p['next_tasks'][0]['family'],'B');tid=p['next_tasks'][0]['id'];self.e.db.execute("update tasks set status='completed' where id=?",(tid,));self.assertNotIn(tid,[t['id'] for t in self.e.plan(cell,['A','B'])['next_tasks']])
 def test_diminishing_returns_requires_independent_runs_and_minimum_sample(self):
  rows=[self.row(f'https://a.test/{i}',name=f'Company {i}') for i in range(12)];self.ingest(rows,captured_at='2026-09-15T00:00:00Z')
  for n,source in enumerate(['B','C','D']):self.ingest([{**r,'source_url':r['source_url'].replace('a.test',source+'.test')} for r in rows],source=source,captured_at=f'2026-09-{16+n}T00:00:00Z',coverage_complete=True)
  p=self.e.plan([{'scope':'region','category':'*'}],['A','B','C','D']);self.assertEqual(p['coverage'][0]['status'],'diminishing_returns_review');self.assertIsNone(p['coverage'][0]['completeness_probability'])
if __name__=='__main__':unittest.main()
