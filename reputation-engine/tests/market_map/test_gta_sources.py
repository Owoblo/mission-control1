import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.gta_sources import write_discovery_ledger

class GtaLedgerTests(unittest.TestCase):
    def test_planned_lanes_do_not_claim_executed_search_or_acquired_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);folder=base/'gta';folder.mkdir();source=base/'toronto-licences-full-next-release';source.mkdir()
            (source/'manifest.json').write_text(json.dumps({'dataset_portal':'https://official.test/dataset','source_url':'https://official.test/full.csv','licence_url':'https://official.test/licence','source_id':'toronto-business-licences','raw_rows':160102,'native_object_ids':160102,'source_currency':'2026-10-24'}))
            with patch('scripts.market_map.geography.configured_footprint',return_value=[{'label':'Toronto','configured_runtime':True,'areas':['toronto']},{'label':'Caledon','configured_runtime':True,'areas':['toronto']}]):
                path=write_discovery_ledger(folder)
            rows=list(map(json.loads,path.read_text().splitlines()));planned=[r for r in rows if r['status']=='unsearched']
            self.assertEqual(len(planned),28)
            self.assertTrue(all(r['evidence_urls']==[] and not r.get('acquired_raw_rows') for r in planned))
            self.assertTrue(all(not r['market_completeness_verified'] for r in rows))
            complete=[r for r in rows if r['status']=='acquired_complete'];self.assertEqual(len(complete),1)
            self.assertEqual(complete[0]['configured_labels'],['Toronto'])
            self.assertNotIn('Caledon',complete[0]['configured_labels'])
            schema=json.loads((Path(__file__).resolve().parents[2]/'scripts/market_map/config/discovery-ledger-schema.json').read_text())
            for row in rows:
                self.assertTrue(set(schema['required'])<=set(row));self.assertIn(row['status'],schema['properties']['status']['enum']);self.assertIn(row['source_family'],schema['properties']['source_family']['enum'])
