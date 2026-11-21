import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map import windsor_role_register as register


class RoleRegisterTests(unittest.TestCase):
    def test_requires_integrated_batch_and_retains_scope_without_authority(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            batch = root/'artifacts/windsor-parallel-example'
            batch.mkdir(parents=True)
            (batch/'integration-receipt.json').write_text('{}')
            row = dict(person_name='Published Person', organization='Company', published_role='Branch contact',
                       scope='Windsor branch only', checked_on='2026-10-29', source_url='https://example.org/contact',
                       raw_evidence_reference='source.html', published_contact_channels=[])
            (batch/'professional_roles.json').write_text(json.dumps([row,row,{**row,'scope':''}]))
            other = root/'artifacts/windsor-parallel-unintegrated'
            other.mkdir(); (other/'professional_roles.json').write_text(json.dumps([row]))
            with patch.object(register,'ROOT',root), patch.object(register,'validate_reference',return_value={'source_sha256':'test'}):
                register.build()
            data = json.loads((root/'artifacts/windsor-role-register-20261029/roles.json').read_text())
            self.assertEqual(data['summary']['role_observations'],1)
            self.assertEqual(data['summary']['held'],1)
            self.assertEqual(data['observations'][0]['scope'],'Windsor branch only')
            self.assertFalse(data['observations'][0]['current_authority_independently_verified'])
            self.assertFalse(data['observations'][0]['outreach_eligible'])


if __name__ == '__main__': unittest.main()
