import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.recheck_regional_emails import recheck
from scripts.market_map.cloud import regional_contact_enrichment as regional


class RegionalEmailRecheckTests(unittest.TestCase):
    def fixture(self,root):
        folder=root/'sources'/hashlib.sha256(b'business.test').hexdigest()[:20];folder.mkdir(parents=True)
        body=b'<p>info@business.test</p><button data-email="jane@business.test">Email</button>'
        path=folder/'0.html';path.write_bytes(body)
        receipt={'host':'business.test','records':[{'municipality':'Windsor'}],'pages':[{'url':'https://business.test/team','body_path':str(path),'sha256':hashlib.sha256(body).hexdigest(),'phones':[{'phone':'519-555-0100'}],'emails':[{'email':'info@business.test'}]}]}
        (folder/'receipt.json').write_text(json.dumps(receipt));return folder,receipt

    def test_recheck_delta_and_no_primary_writes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder,receipt=self.fixture(root)
            before=(folder/'receipt.json').read_bytes()
            with patch.object(regional.Transport,'fetch',side_effect=AssertionError('No network')):
                result=recheck(root,root/'review')
            self.assertEqual(result['additional_unique_emails'],1)
            self.assertEqual(result['recovered_unique_emails'],2)
            self.assertEqual(result['crm_writes'],0)
            self.assertEqual((folder/'receipt.json').read_bytes(),before)

    def test_cached_capture_upgrades_email_only_without_fetch(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder,receipt=self.fixture(root)
            with patch.object(regional,'OUT',root),patch.object(regional.Transport,'fetch',side_effect=AssertionError('No network')):
                updated=regional.capture({'host':'business.test'})
            self.assertEqual({r['email'] for r in updated['pages'][0]['emails']},{'info@business.test','jane@business.test'})
            self.assertEqual(updated['pages'][0]['phones'],receipt['pages'][0]['phones'])
            self.assertEqual(updated['pages'][0]['email_extraction_version'],regional.EMAIL_VERSION)

    def test_hash_mismatch_is_a_gap_not_new_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder,receipt=self.fixture(root)
            (folder/'0.html').write_text('injected@business.test')
            result=recheck(root,root/'review')
            self.assertEqual(result['coverage_gaps'],1)
            self.assertEqual(result['recovered_unique_emails'],0)


if __name__=='__main__':unittest.main()
