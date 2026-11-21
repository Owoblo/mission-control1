import csv
import gzip
import io
import json
import sys
import tempfile
import zipfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from market_map.civic_sources import (MOH_LAYER, MOH_ITEM, MOH_FIELDS, OGL_ON,
    normalise_moh_feature, normalise_civic_csv, acquire_moh, apply_civic_acquisition, _write_rows, library_xlsx_csv, write_blocked_source_handoff)
from market_map.store import MarketMap
from market_map.geography import seed_geographies
from market_map.transport import Response, SourceBlocked


def feature(ident=1, name='Fixture Hospital Site', service='Hospital'):
    return {'attributes':{'OBJECTID':ident,'OGF_ID':1000+ident,'MOH_SERVICE_PROVIDER_IDENT':'provider-1',
        'ENGLISH_NAME':name,'SERVICE_TYPE':service,'SERVICE_TYPE_DETAIL':'Hospital Site',
        'ADDRESS_LINE_1':'10 Fixture Street','COMMUNITY':'London','POSTAL_CODE':'N6A1A1',
        'ADDRESS_DESCRIPTOR':'Billing, Administration, & Practice Address','EFFECTIVE_DATETIME':1707992793000},
        'geometry':{'x':-81.25,'y':42.98}}


class FakeTransport:
    def __init__(self, mismatch=False):
        self.requests=self.bytes_fetched=0
        self.mismatch=mismatch
    def metrics(self):
        return {'requests':self.requests,'bytes_fetched':self.bytes_fetched,'cache_hits':0,'elapsed_seconds':.1}
    def fetch(self,url):
        self.requests+=1
        query=parse_qs(urlsplit(url).query)
        if url==MOH_ITEM:
            data={'url':MOH_LAYER,'licenseInfo':OGL_ON,'modified':1707992793000}
        elif '/query?' not in url:
            data={'fields':[{'name':key} for key in MOH_FIELDS],'geometryType':'esriGeometryPoint','copyrightText':OGL_ON,'maxRecordCount':1000}
        elif query.get('returnCountOnly'):
            data={'count':2}
        elif query.get('returnIdsOnly'):
            data={'objectIds':[1,2]}
        else:
            assert query['where']==['OBJECTID >= 1 AND OBJECTID <= 2']
            assert query['outSR']==['4326']
            data={'features':[feature(1),feature(3 if self.mismatch else 2,'Fixture LTC','Long-Term Care Home')],'spatialReference':{'wkid':4326}}
        body=json.dumps(data).encode()
        self.bytes_fetched+=len(body)
        return Response(body,{},url)


class CivicSourceTests(unittest.TestCase):
    def test_health_location_preserves_mixed_address_roles_and_never_infers_operator(self):
        row=normalise_moh_feature(feature(),observed_at='2026-10-26T00:00:00Z')
        self.assertEqual(row['entity_type'],'institution_site_candidate')
        self.assertEqual(row['location_type'],'healthcare_practice_or_administration_address_candidate')
        self.assertFalse(row['current_occupancy_verified'])
        self.assertFalse(row['source_parent_inferred'])
        self.assertNotIn('legal_name',row)
        self.assertNotIn('naics',row)
        self.assertNotIn('parent_name',row)
        self.assertEqual(row['source_effective_datetime'],'2024-02-15T10:26:33+00:00')
        self.assertEqual(normalise_moh_feature(feature(service='Long-Term Care Homes'),observed_at='now')['industry_family'],'senior_living')
        mailing=feature();mailing['attributes']['ADDRESS_DESCRIPTOR']='Mailing Address'
        self.assertEqual(normalise_moh_feature(mailing,observed_at='now')['location_type'],'mailing_address')
        broken=feature();broken['attributes']['OGF_ID']=None
        with self.assertRaises(SourceBlocked):normalise_moh_feature(broken,observed_at='now')

    def test_exact_inventory_acquisition_and_source_dates_are_distinct_from_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            m=acquire_moh(directory,FakeTransport())
            self.assertEqual(m['records_count'],2)
            self.assertTrue(m['official_id_inventory_exhausted'])
            self.assertEqual(m['source']['rights_status'],'licensed_open')
            self.assertIsNone(m['source']['source_date'])
            self.assertFalse(m['canonical_database_mutated'])
            self.assertEqual(m['scope_counts']['unknown_unresolved_without_geography_database'],2)
            with gzip.open(Path(directory)/'ontario-moh-service-locations'/m['records_file'],'rt') as handle:
                rows=[json.loads(line) for line in handle]
            self.assertEqual(rows[0]['source_record_id'],'ogf:1001')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(SourceBlocked,'source IDs'):
                acquire_moh(directory,FakeTransport(mismatch=True))
            self.assertFalse((Path(directory)/'ontario-moh-service-locations/manifest.json').exists())

    def test_actual_opp_and_quoted_courthouse_schemas_keep_offices_distinct(self):
        body=b'name_en,name_fr,designation,location,address,region,command\nFixture Bureau,,Bureau,London,"10 Fixture Street, London, Ontario N6A 1A1",West,Fixture Command\nOther Bureau,,Bureau,London,"10 Fixture Street, London, Ontario N6A 1A1",West,Fixture Command\n'
        rows=normalise_civic_csv(body,kind='opp',observed_at='now',source_url='https://source.test/opp')
        self.assertEqual(len(rows),2)
        self.assertNotEqual(rows[0]['source_record_id'],rows[1]['source_record_id'])
        self.assertEqual(rows[0]['postal_code'],'N6A 1A1')
        self.assertEqual(rows[0]['source_reporting_command'],'Fixture Command')
        court=b"'Bldg_Ministry_Official_Name','Bldg_City','Bldg_Postal_Code','Bldg_Latitude','Bldg_Longitude'\n10 Fixture St - London Courthouse,London,N6A1A1,42.98,-81.25\n"
        court_row=normalise_civic_csv(court,kind='court',observed_at='now',source_url='https://source.test/court',source_date='2015-04-30')[0]
        self.assertEqual(court_row['address'],'10 Fixture St')
        self.assertEqual(court_row['name'],'10 Fixture St - London Courthouse')
        self.assertEqual(court_row['longitude'],-81.25)
        self.assertEqual(court_row['source_effective_datetime'],'2015-04-30')

    def test_guarded_apply_replays_without_duplicate_entities_and_raw_hash_blocks_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            manifest=acquire_moh(folder,FakeTransport())
            with MarketMap(':memory:') as store:
                seed_geographies(store)
                first=apply_civic_acquisition(store,folder,batch_size=1)
                self.assertEqual(first['source_rows_processed'],2)
                self.assertEqual(first['sources'][0]['new_organisations'],2)
                self.assertEqual(first['sources'][0]['new_locations'],2)
                second=apply_civic_acquisition(store,folder,batch_size=1)
                self.assertEqual(second['sources'][0]['new_organisations'],0)
                self.assertEqual(second['sources'][0]['replayed_batches'],2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0],2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM people').fetchone()[0],0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM properties').fetchone()[0],0)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM relationships').fetchone()[0],0)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM field_assertions WHERE entity_type='organisation' AND field_name='source_address_role'").fetchone()[0],2)
                self.assertEqual(store.db.execute("SELECT COUNT(*) FROM field_assertions WHERE entity_type='location' AND field_name='source_address_role'").fetchone()[0],2)
            raw=folder/'ontario-moh-service-locations/raw-page-000000.json'
            raw.write_bytes(raw.read_bytes()+b' ')
            with MarketMap(':memory:') as untouched:
                with self.assertRaisesRegex(SourceBlocked,'receipt checksum'):
                    apply_civic_acquisition(untouched,folder)
                self.assertEqual(untouched.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0],0)
                self.assertEqual(untouched.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0],0)

    def test_library_workbook_contracting_body_is_not_a_branch_or_city_only_site(self):
        content=io.BytesIO()
        ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        with zipfile.ZipFile(content,'w') as z:
            z.writestr('xl/sharedStrings.xml',f'<sst xmlns="{ns}"><si><t>Library Full Name</t></si><si><t>Library Number</t></si><si><t>A1.4 Type of Library Service (English)</t></si><si><t>A1.10 City/Town</t></si><si><t>Fixture Municipality</t></si><si><t>Contracting Municipality</t></si><si><t>London</t></si></sst>')
            z.writestr('xl/worksheets/sheet1.xml',f'<worksheet xmlns="{ns}"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row><row><c r="A2" t="s"><v>4</v></c><c r="B2"><v>00001</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" t="s"><v>6</v></c></row></sheetData></worksheet>')
        body=library_xlsx_csv(content.getvalue())
        rows=normalise_civic_csv(body,kind='library',observed_at='2026-10-26T00:00:00Z',source_url='https://source.test/library',source_date='2025')
        self.assertEqual(rows[0]['entity_type'],'public_service_roster_body_candidate')
        self.assertEqual(rows[0]['source_respondent_city'],'London')
        self.assertIsNone(rows[0]['city'])
        self.assertIsNone(rows[0]['postal_code'])
        self.assertFalse(rows[0]['physical_location_asserted'])
        self.assertEqual(rows[0]['source_record_id'],'library:00001')
        with tempfile.TemporaryDirectory() as directory:
            source={'id':'fixture-library','name':'Fixture library survey','source_url':'https://source.test/library','rights_status':'licensed_open','adapter_name':'fixture-civic','source_type':'institutional_directory'}
            _write_rows(directory,rows,source,raw_receipts=[],source_count=1,observed_at='2026-10-26T00:00:00Z',metrics={},acquisition_id='fixture-library-acquisition')
            with MarketMap(':memory:') as store:
                result=apply_civic_acquisition(store,directory)
                self.assertEqual(result['sources'][0]['new_organisations'],1)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM locations').fetchone()[0],0)

    def test_explicit_command_relationship_uses_exact_same_source_names_and_replays(self):
        raw=b'name_en,designation,location,address,command\nFixture Command,Bureau,London,10 Fixture St,NA\nFixture Office,Bureau,London,20 Fixture St,Fixture Command\nUnmatched Office,Bureau,London,30 Fixture St,Unlisted Command\n'
        rows=normalise_civic_csv(raw,kind='opp',observed_at='2026-10-26T00:00:00Z',source_url='https://source.test/opp')
        source={'id':'fixture-opp','name':'Fixture offices','source_url':'https://source.test/opp','rights_status':'licensed_open','adapter_name':'fixture-civic','source_type':'institutional_directory'}
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            rawfile=folder/'original.csv';rawfile.write_bytes(raw)
            import hashlib
            manifest=_write_rows(folder,rows,source,raw_receipts=[{'file':rawfile.name,'sha256':hashlib.sha256(raw).hexdigest()}],source_count=3,observed_at='2026-10-26T00:00:00Z',metrics={'requests':1,'bytes_fetched':len(raw)},acquisition_id='fixture-civic-invocation')
            self.assertEqual(manifest['explicit_command_relationships'],1)
            with MarketMap(':memory:') as store:
                result=apply_civic_acquisition(store,folder,batch_size=1)
                self.assertEqual(result['sources'][0]['new_explicit_command_relationships'],1)
                repeated=apply_civic_acquisition(store,folder,batch_size=1)
                self.assertEqual(repeated['sources'][0]['new_explicit_command_relationships'],0)
                relation=store.db.execute('SELECT * FROM relationships').fetchone()
                self.assertEqual(relation['predicate'],'reports_to_command')
                self.assertIsNotNone(store.db.execute('SELECT 1 FROM evidence WHERE id=?',(relation['evidence_id'],)).fetchone())
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM properties').fetchone()[0],0)

    def test_blocked_handoff_rejects_unsearched_leads_and_keeps_exact_error(self):
        with tempfile.TemporaryDirectory() as directory:
            row={'source_id':'fixture-block','source_url':'https://source.test/data','retrieval_status':'blocked',
                 'rights_status':'licensed_open','latest_recorded_error':'HTTP503 robots policy unavailable',
                 'observation_reference':'saved-failure.json','permitted_next_step':'Retry when official policy is interpretable'}
            result=write_blocked_source_handoff(directory,[row])
            self.assertEqual(result['blocked_or_restricted_sources'],1)
            saved=json.loads((Path(directory)/'blocked-source-handoff.json').read_text())
            self.assertEqual(saved[0]['latest_recorded_error'],row['latest_recorded_error'])
            with self.assertRaisesRegex(ValueError,'actual recorded'):
                write_blocked_source_handoff(directory,[{**row,'retrieval_status':'not_searched'}])


if __name__=='__main__':unittest.main()
