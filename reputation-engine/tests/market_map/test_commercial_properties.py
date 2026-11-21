import csv
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from market_map.commercial_properties import (normalise_crown_inventory,normalise_ottawa_feature,reconcile_ottawa_records,
    parse_bounded_profile,policy_restriction,_write_batch,apply_commercial_acquisition)
from market_map.store import MarketMap,stable_id
from market_map.transport import SourceBlocked
from market_map.place_import import StoragePaused


class CommercialPropertyTests(unittest.TestCase):
    def fixture_data(self):
        header=['Fiscal-year_Exercice-financier','AO_ID','Province-Code_Code-de-province','Structure-address_Adresse-du-structure-ENG',
            'DFRP-property-No_No-bien-immobilier-RBIF','DFRP-structure-No_No-structure-RBIF','Property-name_Nom-du-bien-ENG','Structure-name_Nom-du-structure-ENG','City-Ville','Interest-Type_Type-de-propriété-ENG']
        buffer=io.StringIO();w=csv.writer(buffer);w.writerow(header)
        w.writerow(['2023-2024','fixture-asset-A','ON','10 Fixture St','0007','0031','Fixture Campus','Fixture Building A','London','Crown-owned'])
        w.writerow(['2023-2024','fixture-asset-B','ON','10 Fixture St','0007','0031','Fixture Campus','Fixture Building B','London','Lease purchase'])
        w.writerow(['2023-2024','fixture-outside','QC','20 Fixture St','0008','0032','Outside Campus','Outside Building','Montreal','Crown-owned'])
        return normalise_crown_inventory(buffer.getvalue().encode())

    def write_fixture(self,folder,*,rights='licensed_open',review=None):
        source={'id':'fixture-property-source','name':'Fixture historical property source','publisher':'Fixture Public Body',
            'publisher_entity_type':'government_body','publisher_website':'https://publisher.test','source_url':'https://publisher.test/portfolio',
            'rights_status':rights,'source_type':'landlord_portfolio'}
        return _write_batch(folder,source,self.fixture_data(),[],{'requests':1,'bytes_fetched':100},
            rights_review=review or {'status':'explicit_open_licence'},inventory_exhausted=True)

    def test_asset_ids_are_not_false_unique_structure_ids_and_parent_address_is_not_copied(self):
        data=self.fixture_data()
        self.assertEqual(data['national_source_observations'],3)
        self.assertEqual(data['ontario_source_observations'],2)
        self.assertEqual(data['source_asset_ids'],2)
        self.assertEqual(data['source_dfrp_structure_numbers'],1)
        self.assertEqual(len(data['properties']),3)
        parent=next(p for p in data['properties'] if p['property_key'].startswith('dfrp'))
        self.assertEqual(parent['property_key'],'dfrp-property:0007')
        self.assertIsNone(parent['address'])
        self.assertIsNone(parent['city'])
        self.assertEqual(data['source_periods'],['2023-2024'])
        self.assertTrue(all(r['current_ownership_or_occupancy_verified'] is False for r in data['observations']))

    def test_all_layer_observations_remain_while_duplicate_symbols_and_rooms_do_not_inflate_property_groups(self):
        def feature(oid,room):
            return {'attributes':{'OBJECTID':oid,'BUILDING_DESC':'Fixture Complex','BUILDING_ELEMENT_DESC':room,
                'BUILDING_ELEMENT_TYPE':'Meeting Room','ADDRNUM':100,'FULLNAME':'Fixture St'},'geometry':{'x':-75.7,'y':45.4}}
        rows=[normalise_ottawa_feature(feature(1,'Fixture Room'),2)['observation'],
              normalise_ottawa_feature(feature(1,'Fixture Room'),5)['observation'],
              normalise_ottawa_feature(feature(2,'Other Room'),5)['observation']]
        props,report=reconcile_ottawa_records(rows)
        self.assertEqual(len(rows),3)
        self.assertEqual(len(props),1)
        self.assertEqual(report['unique_complete_feature_fingerprints'],2)
        self.assertEqual(report['exact_duplicate_cartographic_observations'],1)
        self.assertEqual(rows[1]['cartographic_duplicate_of_source_record_id'],rows[0]['source_record_id'])
        self.assertIsNone(props[0]['city'])
        self.assertFalse(report['is_unique_verified_building_or_legal_parcel_count'])

    def test_privacy_consent_is_not_a_site_reuse_restriction_but_actual_terms_are_held(self):
        self.assertIsNone(policy_restriction('We do not collect personal information without the customer’s express consent.'))
        self.assertIsNotNone(policy_restriction('The Site is available for your personal, non-commercial use.'))
        self.assertIsNotNone(policy_restriction('No content may be copied or reproduced without permission.'))

    def test_profile_address_does_not_come_from_company_footer_and_tenant_labels_are_bounded(self):
        body=b'<html><head><title>Fixture Tower in London, Ontario</title></head><body><main><h1>Fixture Tower</h1><h3>01 Location</h3><p>Located at 255 Fixture Ave. near the central district.</p><h3>03 Featured Tenants</h3><ul><li>Fixture A</li><li>Fixture B</li><li>Fixture C</li><li>Fixture D</li></ul></main><footer>999 Wrong Street, Toronto, ON</footer></body></html>'
        row=parse_bounded_profile(body,'https://publisher.test/fixture')
        self.assertEqual(row['city'],'London')
        self.assertTrue(row['address'].startswith('255 Fixture Ave'))
        self.assertNotIn('999',row['address'])
        self.assertEqual(row['source_featured_tenant_labels'],['Fixture A','Fixture B','Fixture C'])
        self.assertFalse(row['full_private_html_retained'])

    def test_atomic_idempotent_apply_has_joinable_evidence_and_no_property_as_company_or_site_inflation(self):
        with tempfile.TemporaryDirectory() as directory,MarketMap(':memory:') as store:
            self.write_fixture(directory)
            first=apply_commercial_acquisition(store,directory)
            self.assertEqual(first['sources'][0]['properties_added'],3)
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0],1)
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM locations').fetchone()[0],0)
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM people').fetchone()[0],0)
            self.assertEqual(store.db.execute("SELECT COUNT(*) FROM relationships WHERE predicate='part_of_property'").fetchone()[0],2)
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM relationships r LEFT JOIN evidence e ON e.id=r.evidence_id WHERE e.id IS NULL').fetchone()[0],0)
            second=apply_commercial_acquisition(store,directory)
            self.assertTrue(second['sources'][0]['replayed'])
            self.assertEqual(store.db.execute('SELECT COUNT(*) FROM properties').fetchone()[0],3)

    def test_changed_snapshot_is_rejected_before_writes_and_existing_nonempty_values_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory,MarketMap(':memory:') as store:
            self.write_fixture(directory)
            ident=stable_id('source-property','fixture-property-source','ao:fixture-asset-A')
            store.db.execute("INSERT INTO properties(id,property_name,address) VALUES(?,?,'Reviewed Manual Address')",(ident,'Manual Property'))
            store.db.commit()
            result=apply_commercial_acquisition(store,directory)
            self.assertGreaterEqual(result['sources'][0]['property_conflicts_queued'],1)
            self.assertEqual(store.db.execute('SELECT address FROM properties WHERE id=?',(ident,)).fetchone()[0],'Reviewed Manual Address')
            path=Path(directory)/'batch.json';path.write_bytes(path.read_bytes()+b' ')
            with MarketMap(':memory:') as untouched:
                with self.assertRaisesRegex(SourceBlocked,'checksum'):
                    apply_commercial_acquisition(untouched,directory)
                self.assertEqual(untouched.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0],0)

    def test_late_assertion_failure_rolls_back_the_entire_source_snapshot(self):
        with tempfile.TemporaryDirectory() as directory,MarketMap(':memory:') as store:
            self.write_fixture(directory)
            original=store.assert_field;calls=[0]
            def fail_after_property(*args,**kwargs):
                calls[0]+=1
                if calls[0]>5:raise RuntimeError('fixture late assertion failure')
                return original(*args,**kwargs)
            with patch.object(store,'assert_field',side_effect=fail_after_property):
                with self.assertRaisesRegex(RuntimeError,'fixture late'):
                    apply_commercial_acquisition(store,directory)
            for table in ['properties','organisations','evidence','raw_records','source_runs','sources']:
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)

    def test_storage_pause_includes_required_source_folder_and_chunk_context_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)/'batch';self.write_fixture(folder)
            with MarketMap(Path(directory)/'fixture.sqlite') as store:
                with patch('market_map.commercial_properties._require_space'),patch('market_map.place_import.shutil.disk_usage',return_value=SimpleNamespace(free=1024)):
                    with self.assertRaises(StoragePaused) as caught:
                        apply_commercial_acquisition(store,folder)
                self.assertEqual(caught.exception.context['source_folder'],str(folder))
                self.assertEqual(caught.exception.context['chunk'],0)
                self.assertEqual(caught.exception.context['source_id'],'fixture-property-source')
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0],0)


if __name__=='__main__':unittest.main()
