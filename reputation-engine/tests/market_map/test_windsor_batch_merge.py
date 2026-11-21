import hashlib
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.windsor_batch_merge import merge_rows, observation_key


class BatchMergeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name).resolve()
        (self.root/'source.html').write_text('Public company evidence')
        self.row = {'organization':'Business A', 'address':'12 Main St E', 'unit_or_floor':'Suite 1',
                    'relationship':'Operating location published by company', 'source_url':'https://example.com/contact',
                    'status':'company_published_address', 'checked_on':'2026-10-29',
                    'raw_evidence_reference':'source.html', 'published_contact_channels':[]}
    def tearDown(self): self.tmp.cleanup()

    def test_rerun_idempotent_and_prior_record_untouched(self):
        records, result = merge_rows([], [self.row], self.root)
        repeated, again = merge_rows(records, [self.row], self.root)
        self.assertEqual(result['added_observations'],1)
        self.assertEqual(records,repeated)
        self.assertEqual(again['same_observation_duplicates'],1)

    def test_same_address_distinct_tenant_suite_or_source_stays_separate(self):
        variants = [self.row, {**self.row,'organization':'Business B'},
                    {**self.row,'unit_or_floor':'Suite 2'},
                    {**self.row,'source_url':'https://other.example/listing'}]
        records, result = merge_rows([], variants, self.root)
        self.assertEqual(len(records),4)
        self.assertEqual(len({observation_key(r) for r in records}),4)

    def test_missing_changed_or_outside_evidence_held(self):
        bad = [{**self.row,'raw_evidence_reference':'missing.html'},
               {**self.row,'source_sha256':'0'*64},
               {**self.row,'raw_evidence_reference':'/etc/hosts'}]
        records,result = merge_rows([],bad,self.root)
        self.assertEqual(records,[])
        self.assertEqual(result['held_observations'],3)

    def test_outreach_private_residents_and_restricted_source_rejected(self):
        bad = [{**self.row,'outreach_eligible':True}, {**self.row,'private_residential_occupant':True},
               {**self.row,'source_url':'https://www.scpl.com/residential-rental/test'}]
        records,result = merge_rows([],bad,self.root)
        self.assertEqual(records,[])
        self.assertEqual(result['held_observations'],3)

    def test_contact_scope_required(self):
        row = {**self.row,'published_contact_channels':[{'type':'phone','value':'519-555-0100'}]}
        records,result = merge_rows([],[row],self.root)
        self.assertEqual(result['held_observations'],1)

    def test_distinct_provider_record_ids_are_not_erased(self):
        records,result = merge_rows([],[{**self.row,'source_record_id':1},
                                      {**self.row,'source_record_id':2}],self.root)
        self.assertEqual(result['added_observations'],2)
        self.assertEqual(len(records),2)

    def test_structured_source_receipt_retains_metadata_and_checks_hash(self):
        digest=hashlib.sha256((self.root/'source.html').read_bytes()).hexdigest()
        row={**self.row,'raw_evidence_reference':{'path':'source.html','sha256':digest,'source_url':'https://example.com/public.js'}}
        records,result=merge_rows([],[row],self.root)
        self.assertEqual(result['added_observations'],1)
        self.assertEqual(records[0]['raw_evidence_reference'],'source.html')
        self.assertEqual(records[0]['source_evidence']['source_url'],'https://example.com/public.js')
        row['raw_evidence_reference']['sha256']='0'*64
        self.assertEqual(merge_rows([],[row],self.root)[1]['held_observations'],1)


if __name__ == '__main__': unittest.main()
