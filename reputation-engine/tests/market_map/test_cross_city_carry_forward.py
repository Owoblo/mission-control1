import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map import cross_city_carry_forward as module


class CarryForwardTests(unittest.TestCase):
    def test_preserves_old_ids_and_keeps_private_site_licence_separate(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root/'artifacts/windsor-parallel-institutions-20261029-batch02'
            source.mkdir(parents=True)
            row = {'source_id':'city','source_record_id':'123','name':'School','address':'1 Main',
                   'municipality_published':'LaSalle','source_url':'https://example.org/gis',
                   'status':'outside_canonical_windsor_boundary'}
            (source/'held.json').write_text(json.dumps([row]))
            extra = root/'artifacts/windsor-parallel-campus'
            extra.mkdir(); (extra/'integration-receipt.json').write_text('{}')
            (extra/'cross-city-observations.json').write_text(json.dumps([{'organization':'Campus','address':'2 Main',
                'municipality_published':'Chatham','operator_group':'College','source_url':'https://example.org/campus',
                'rights_status':'internal research only','relationship':'operator campus'}]))
            catalog = root/'partnership-system/catalogs'
            catalog.mkdir(parents=True); (catalog/'service-areas.json').write_text(json.dumps({'locations':[{'location':'LaSalle'},{'location':'Chatham'}]}))
            with patch.object(module,'ROOT',root), patch.object(module,'validate_reference',return_value={'source_sha256':'test'}):
                module.build()
            records = json.loads((root/'artifacts/cross-city-carry-forward-20261029/leads.json').read_text())
            self.assertEqual(records[0]['carry_forward_id'],hashlib.sha256(b'city|123').hexdigest())
            self.assertEqual(records[1]['licence'],'internal research only')
            self.assertEqual(records[1]['operator_group'],'College')
            self.assertFalse(records[1]['destination_boundary_verified'])
            self.assertFalse(records[1]['outreach_eligible'])


if __name__ == '__main__': unittest.main()
