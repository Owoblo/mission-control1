import tempfile
import unittest
from pathlib import Path
from scripts.market_map.windsor_building_ledger import entry

class BuildingLedgerTests(unittest.TestCase):
    def setUp(self):
        self.row=dict(building_id='b1',longitude=-83,latitude=42,business_zone_research_candidate=True,source_zoning=['CD1'],parcel_address_candidates=['1 Main St'],status='reported_place',covering_place_ids=['p1'])
        self.places={'p1':{'name':'Company','source_url':'https://example.org'}}
        self.evidence=[{'organization':'Company','address':'1 Main St','source_url':'https://example.org','candidate_building_ids':['b1','b2']}]
    def test_matches_never_mark_individual_review_complete(self):
        r,held=entry(self.row,self.evidence,self.places)
        self.assertEqual(r['investigation_status'],'not_individually_reviewed')
        self.assertEqual(r['ambiguous_multi_footprint_observations'],1)
        self.assertEqual(r['occupant_completeness'],'unknown')
    def test_requires_all_scoped_sourced_stages_and_preserves_gaps(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'evidence.txt').write_text('Published evidence')
            event=dict(building_id='b1',stage='address',outcome='reviewed',checked_on='2026-10-29',reviewer='research',scope='Street address only',finding='Published address',remaining_gaps=['Upper-floor occupants unknown'],source_url='https://example.org',raw_evidence_reference='evidence.txt')
            r,_=entry(self.row,self.evidence,self.places,[event],root)
            self.assertEqual(r['investigation_status'],'in_progress')
            events=[{**event,'stage':s} for s in ('address','occupants','contacts')]
            r,_=entry(self.row,self.evidence,self.places,events,root)
            self.assertEqual(r['investigation_status'],'scope_reviewed')
            self.assertEqual(r['occupant_completeness'],'unknown')
            self.assertTrue(r['review_events'][0]['remaining_gaps'])
            r,held=entry(self.row,self.evidence,self.places,[{**event,'raw_evidence_reference':'missing.txt'}],root)
            self.assertEqual(len(held),1)
            self.assertEqual(r['investigation_status'],'not_individually_reviewed')
            r,_=entry(self.row,self.evidence,self.places,events+[{**event,'stage':'address','outcome':'unresolved'}],root)
            self.assertEqual(r['investigation_status'],'in_progress')

if __name__=='__main__':unittest.main()
