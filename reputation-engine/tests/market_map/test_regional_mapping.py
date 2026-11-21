import gzip,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map.cloud import regional_mapping as m

class RegionalMappingTests(unittest.TestCase):
    def test_dedup_boundary_hold_and_restart_skip(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);inputs=root/'inputs';inputs.mkdir();out=root/'out'
            features=[]
            for i,code in enumerate(m.MUNICIPALITIES):
                x=-83+i*.1
                features.append({'type':'Feature','properties':{'MUNID':code},'geometry':{'type':'Polygon','coordinates':[[[x,42],[x+.05,42],[x+.05,42.05],[x,42.05],[x,42]]]}})
            with gzip.open(inputs/'municipal-polygons.geojson.gz','wt') as f:json.dump({'features':features},f)
            place={'source_record_id':'one','name':'Example </script>','categories':'shop','longitude':-82.98,'latitude':42.02,'phone':'+1 519 555 0123'}
            with gzip.open(inputs/'places.gz','wt') as f:
                for r in [place,place,dict(place,source_record_id='edge',longitude=-83)]:f.write(json.dumps(r)+'\n')
            (inputs/'county-licence.pdf').write_bytes(b'fixture')
            manifest={'files':{f.name:m.digest(f) for f in inputs.iterdir()},'place_files':['places.gz'],'county_licence_url':'https://example.test/license','limits':[],'physical_foundation':[]}
            m.save(inputs/'manifest.json',manifest)
            with patch.object(m,'Transport') as transport:
                transport.return_value.fetch.side_effect=RuntimeError('Fixture unavailable')
                result=m.run(inputs,out)
                self.assertEqual(result['place_records'],1)
                self.assertEqual(result['source_holds'],5)
                self.assertEqual(json.loads((out/'spatial-holds.json').read_text())[0]['reason'],'ambiguous_shared_boundary')
                self.assertIn('Example \\u003c/script>',(out/'index.html').read_text())
                transport.reset_mock();again=m.run(inputs,out)
                self.assertEqual(again,result);transport.assert_not_called()
            (inputs/'county-licence.pdf').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'hash mismatch'):m.run(inputs,out)

if __name__=='__main__':unittest.main()
