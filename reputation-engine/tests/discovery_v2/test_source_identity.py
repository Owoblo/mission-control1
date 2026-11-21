import unittest
from engine import Engine
from import_overture import normalize_feature


class SourceIdentityTests(unittest.TestCase):
    def setUp(self): self.engine=Engine(':memory:')
    def tearDown(self): self.engine.db.close()
    def ingest(self, rows, source='publisher', **kwargs):
        return self.engine.ingest(source=source,family='directory',scope='fixture',category='*',rows=rows,**kwargs)
    def row(self, name='Office', identifier=None, **kw):
        row={'name':name,'source_url':'https://directory.test/list',**kw}
        if identifier is not None: row['source_record_id']=identifier
        return row
    def test_shared_directory_separate_publisher_records_and_replay(self):
        rows=[self.row('Alpha','a'),self.row('Beta','b')]
        self.assertEqual(self.ingest(rows)['new_entities'],2)
        self.assertTrue(self.ingest(rows)['replayed'])
        self.assertEqual(self.engine.db.execute('SELECT count(*) FROM source_records').fetchone()[0],2)
        self.assertEqual(self.engine.db.execute('SELECT count(*) FROM source_links').fetchone()[0],0)
    def test_stable_id_conflict_preserved_and_enrichment_keeps_identity(self):
        self.ingest([self.row('Alpha','a')])
        self.assertEqual(self.ingest([self.row('Alpha','a',website='https://alpha.test')],kind='enrichment')['new_entities'],0)
        self.assertEqual(self.ingest([self.row('Beta','a')])['conflicts'],1)
        entity=self.engine.db.execute('SELECT * FROM entities').fetchone()
        self.assertEqual(entity['name'],'Alpha')
        self.assertEqual(self.engine.confidence(entity['id'])['organization_identity']['status'],'conflicting')
    def test_namespaces_composites_units_and_unknown_identity(self):
        self.ingest([self.row('Alpha','same')],source='a')
        self.assertEqual(self.ingest([self.row('Alpha','same')],source='b')['new_entities'],1)
        rows=[self.row('Office',city='Windsor',address='10 Main',unit=u) for u in ['1','2']]
        self.assertEqual(self.ingest(rows)['new_entities'],2)
        result=self.ingest([self.row('Unknown')])
        self.assertEqual((result['new_entities'],result['unresolved_rows']),(0,1))
    def test_profile_identity_requires_adapter_declaration(self):
        self.assertEqual(self.ingest([self.row('Office',source_url_is_record=True)])['new_entities'],1)
    def test_lossy_ascii_and_word_boundary_matches_do_not_merge(self):
        for first,second in [('Café','Caf'),('AB Office','A B Office')]:
            rows=[self.row(n,city='Windsor',address='10 Main',website='shared.test') for n in (first,second)]
            self.assertEqual(self.ingest(rows,source=first)['new_entities'],2)
            self.assertEqual(self.ingest([rows[1]],source=second)['new_entities'],0)
        self.ingest([self.row('Équipe','unicode',city='Windsor',address='20 Main')])
        self.assertEqual(self.ingest([self.row('E\u0301quipe','unicode',city='Windsor',address='20 Main')])['conflicts'],0)
    def test_overture_id_survives_releases(self):
        feature={'geometry':{'type':'Point','coordinates':[1,1]},'properties':{'id':'gers-1','names':{'primary':'Office'}}}
        first=normalize_feature(feature,'release1',[0,0,2,2],'time1')
        second=normalize_feature(feature,'release2',[0,0,2,2],'time2')
        self.ingest([first],source='release1')
        result=self.ingest([second],source='release2')
        self.assertEqual(result['new_entities'],0)
        self.assertEqual(self.engine.db.execute('SELECT namespace FROM source_records').fetchone()[0],'overture_gers')
