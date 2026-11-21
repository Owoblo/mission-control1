import json
import tempfile
import unittest
import gzip
from urllib.parse import parse_qs,urlsplit
from pathlib import Path

from scripts.market_map.regional_facilities import SELECTIONS,selected_datasets,LONDON_FIELDS,acquire_london
from scripts.market_map.transport import SourceBlocked,Response
from scripts.market_map.spatial_context import _hash


class FixtureTransport:
    def __init__(self,mismatch=False):self.requests=0;self.bytes_fetched=0;self.mismatch=mismatch
    def metrics(self):return {'requests':self.requests,'bytes_fetched':self.bytes_fetched,'elapsed_seconds':0}
    def fetch(self,url):
        self.requests+=1;q=parse_qs(urlsplit(url).query)
        if q.get('returnCountOnly'):data={'count':2}
        elif q.get('returnIdsOnly'):data={'objectIds':[1,2]}
        else:
            assert 'owner' not in q['outFields'][0]
            data={'spatialReference':{'wkid':4326},'features':[
                {'attributes':{'OBJECTID':i,'GIS_ID':100+i,'GIS_FeatureKey':'Fixture Venue '+str(i),'Address':'10 Fixture Street'},'geometry':{'x':-81.2,'y':43.0}}
                for i in [1,3 if self.mismatch else 2]]}
        body=json.dumps(data).encode();self.bytes_fetched+=len(body)
        return Response(body,{},url)


class WesternFacilitySelectionTests(unittest.TestCase):
    def write_catalogues(self,folder):
        for city,titles in SELECTIONS.items():
            items=[{'id':city+'-'+str(i),'title':title,'owner':'cambridge.ca' if city=='cambridge' else 'opendata_London',
                'url':'https://maps.example.org/OpenData/MapServer/'+str(i),'licenseInfo':'Official linked open licence'} for i,title in enumerate(sorted(titles))]
            if city=='london':items.append({'id':'unlicensed-working-copy','title':'Business Improvement Areas','owner':'different-working-owner','url':'https://maps.example.org/MapServer','licenseInfo':None})
            (folder/(city+'-official-catalogue-discovery.json')).write_text(json.dumps({'query_inventory_exhausted':True,'candidate_datasets':items}))

    def test_selection_rejects_unlicensed_working_copy_without_losing_curated_item(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);self.write_catalogues(folder)
            items=selected_datasets(folder)
            self.assertEqual(len(items),10)
            self.assertNotIn('unlicensed-working-copy',[r['id'] for r in items])

    def test_missing_curated_licence_or_incomplete_query_stops_before_acquisition(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);self.write_catalogues(folder)
            path=folder/'cambridge-official-catalogue-discovery.json';data=json.loads(path.read_text())
            data['candidate_datasets'][0]['licenseInfo']=None;path.write_text(json.dumps(data))
            with self.assertRaisesRegex(SourceBlocked,'source count differs'):selected_datasets(folder)
            data['query_inventory_exhausted']=False;path.write_text(json.dumps(data))
            with self.assertRaisesRegex(SourceBlocked,'query incomplete'):selected_datasets(folder)

    def source_fixture(self,folder):
        p=folder/'official-facility-schemas';p.mkdir()
        (p/'london-linked-licence.pdf').write_bytes(b'fixture exact reviewed licence')
        (p/'london-licence-review.json').write_text(json.dumps({'lawful_commercial_data_use_reviewed':True,'licence_sha256':_hash(p/'london-linked-licence.pdf')}))
        (p/'inspection.json').write_text(json.dumps({'datasets':[{'publisher_city':'london','title':title,'id':str(i),
            'url':'https://maps.example.org/MapServer/'+str(i),'status':'schema_and_source_count_review_pending','official_count':2,
            'max_record_count':1000,'fields':[{'name':name,'type':'esriFieldTypeString'} for name in fields]} for i,(title,fields) in enumerate(LONDON_FIELDS.items())]}))

    def test_complete_raw_ids_roles_and_frozen_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);self.source_fixture(folder);t=FixtureTransport()
            result=acquire_london(folder,transport=t)
            self.assertEqual(result['raw_observations'],6)
            self.assertEqual(t.requests,9)
            root=folder/'london-open-facility-raw';m=json.loads((root/'manifest.json').read_text())
            self.assertFalse(m['market_completeness_verified'])
            self.assertIsNone(m['distinct_legal_company_or_building_count'])
            roles=[]
            for source in m['sources']:
                with gzip.open(root/source['source_id'].split('-')[-1]/source['records_file'],'rt') as handle:
                    rows=[json.loads(line) for line in handle]
                roles.extend(r['record_unit'] for r in rows)
                self.assertTrue(all(not r['legal_company_identity_asserted'] for r in rows))
                self.assertTrue(source['source_inventory_exhausted'])
            self.assertIn('business_improvement_area_boundary_context',roles)
            self.assertEqual(acquire_london(folder,transport=t)['status'],'frozen_snapshot_preserved')
            self.assertEqual(t.requests,9)

    def test_inventory_conflict_retains_raw_and_never_claims_exhaustion(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);self.source_fixture(folder)
            with self.assertRaisesRegex(SourceBlocked,'ID inventory differs'):
                acquire_london(folder,transport=FixtureTransport(mismatch=True))
            root=folder/'london-open-facility-raw'
            self.assertFalse((root/'manifest.json').exists())
            self.assertTrue(list(root.glob('*/raw-features-*.json')))


if __name__=='__main__':unittest.main()
