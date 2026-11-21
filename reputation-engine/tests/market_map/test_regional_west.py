import csv
import json
import gzip
import io
import tempfile
import unittest
from pathlib import Path

from scripts.market_map.regional_west import (initialise_ledger, record_operation,
    normalise_middlesex, MIDDLESEX_FIELDS, VERSION, apply_western_acquisition,reconcile_ledger)
from scripts.market_map.civic_sources import _write_rows
from scripts.market_map.spatial_context import _hash
from scripts.market_map.store import MarketMap
from scripts.market_map.transport import SourceBlocked


class WesternLedgerTests(unittest.TestCase):
    @staticmethod
    def csv_body(extra_field=False):
        out=io.StringIO(newline='');writer=csv.writer(out)
        writer.writerow(MIDDLESEX_FIELDS+(['representative_name'] if extra_field else []))
        writer.writerow(['Fixture Building Supply','10 Fixture St','London','ON','N6A1A1','5190000000','https://example.org','Building Materials','12']+(['Private Person'] if extra_field else []))
        writer.writerow(['Fixture No Address','','London','ON','','','','',''])
        return out.getvalue().encode()

    def test_operations_keep_scope_and_sector_uncertainty(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            footprint=initialise_ledger(folder)
            self.assertEqual(len(footprint),118)
            op=record_operation(folder,source_id='test',area='WKG',family='business_licences',
                url='https://example.org/export.csv',status='acquired_complete',configured_labels=['Guelph'],
                acquired_raw_rows=10,source_inventory_exhausted=True,record_unit='licence_record')
            self.assertFalse(op['market_completeness_verified'])
            with (folder/'configured-label-source-family-ledger.csv').open() as handle:
                rows=list(csv.DictReader(handle))
            self.assertEqual(len(rows),118*24)
            guelph=next(r for r in rows if r['configured_service_label']=='Guelph' and r['source_family']=='business_licences')
            kitchener=next(r for r in rows if r['configured_service_label']=='Kitchener' and r['source_family']=='business_licences')
            self.assertEqual(guelph['discovery_status'],'acquired_complete')
            self.assertEqual(kitchener['discovery_status'],'unsearched')
            self.assertIn('unsearched',guelph['sector_status_default'])
            before=(folder/'configured-label-source-family-ledger.csv').read_bytes()
            initialise_ledger(folder)
            self.assertEqual(before,(folder/'configured-label-source-family-ledger.csv').read_bytes())

    def test_no_invented_label_or_invalid_status(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);initialise_ledger(folder)
            kwargs=dict(source_id='test',area='WKG',family='municipal_directory',url='https://example.org/',status='source_identified')
            with self.assertRaises(ValueError):record_operation(folder,configured_labels=['Wellington County'],**kwargs)
            with self.assertRaises(ValueError):record_operation(folder,**{**kwargs,'status':'all_cities_complete'})
            self.assertFalse((folder/'discovery-operations.jsonl').exists())

    def test_successful_retry_supersedes_old_block_without_deleting_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);initialise_ledger(folder)
            kwargs=dict(source_id='same-source',area='WKG',family='municipal_directory',url='https://example.org/',configured_labels=['Guelph'])
            record_operation(folder,status='blocked',block_reason='local sandbox DNS failed',**kwargs)
            record_operation(folder,status='source_identified',**kwargs)
            with (folder/'configured-label-source-family-ledger.csv').open() as handle:
                row=next(r for r in csv.DictReader(handle) if r['configured_service_label']=='Guelph' and r['source_family']=='municipal_directory')
            self.assertEqual(row['discovery_status'],'source_identified')
            self.assertEqual(len(row['operation_ids'].split('|')),2)
            self.assertEqual(len((folder/'discovery-operations.jsonl').read_text().splitlines()),2)

    def test_heterogeneous_blocked_handoff_keeps_optional_count_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            (folder/'discovery-receipts.json').write_text('[]')
            (folder/'policy-and-schema-receipts.json').write_text(json.dumps([{'id':'kitchener-layer','query_url':'https://source.example/schema',
                'error':'HTTP403 robots endpoint','rights_status':'licensed_open'}]))
            (folder/'additional-blocked-sources.json').write_text(json.dumps([{'source_id':'fixture-extra','source_url':'https://source.example/roster',
                'retrieval_status':'blocked','rights_status':'limited_factual_review_only','latest_recorded_error':'robots disallows advertised filter',
                'observation_reference':'fixture-receipt.json','permitted_next_step':'Review official permitted manual export.','reported_count':236}]))
            reconcile_ledger(folder)
            with (folder/'blocked-source-handoff.csv').open() as handle:rows=list(csv.DictReader(handle))
            self.assertEqual(len(rows),2)
            self.assertEqual(rows[0]['reported_count'],'')
            self.assertEqual(rows[1]['reported_count'],'236')

    def test_company_schema_rejects_person_fields_and_keeps_unknown_dates_and_counts(self):
        rows=normalise_middlesex(self.csv_body(),observed_at='2026-10-27T00:00:00Z')
        self.assertEqual(rows[0]['source_employee_count'],'12')
        self.assertNotIn('organisation_size_band',rows[0])
        self.assertNotIn('naics',rows[0])
        self.assertIsNone(rows[0]['source_effective_datetime'])
        self.assertEqual(rows[0]['source_fields']['field_phone'],'5190000000')
        self.assertIsNone(rows[1]['city'])
        self.assertEqual(rows[1]['source_respondent_city'],'London')
        with self.assertRaisesRegex(SourceBlocked,'schema changed'):
            normalise_middlesex(self.csv_body(extra_field=True),observed_at='now')

    def test_apply_is_guarded_and_replays_without_duplicate_listings_or_locations(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);body=self.csv_body()
            with gzip.open(folder/'original.csv.gz','wb') as handle:handle.write(body)
            rows=normalise_middlesex(body,observed_at='2026-10-27T00:00:00Z')
            source={'id':'middlesex-county-offered-business-export','name':'Fixture','source_url':'https://example.org/export','source_type':'economic_development','rights_status':'permitted_internal_factual_export','adapter_name':'fixture_western'}
            _write_rows(folder,rows,source,raw_receipts=[{'file':'original.csv.gz','sha256':_hash(folder/'original.csv.gz')}],source_count=2,observed_at='2026-10-27T00:00:00Z',metrics={'requests':2,'bytes_fetched':len(body)},acquisition_id='fixture',extra={'parser_version':VERSION})
            with MarketMap(':memory:') as store:
                first=apply_western_acquisition(store,folder,batch_size=1)
                self.assertEqual(first['new_organisations'],2)
                self.assertEqual(first['new_locations'],1)
                second=apply_western_acquisition(store,folder,batch_size=1)
                self.assertEqual(second['new_organisations'],0)
                self.assertEqual(second['replayed_batches'],2)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM organisations').fetchone()[0],2)
            with (folder/'original.csv.gz').open('ab') as handle:handle.write(b'changed')
            with MarketMap(':memory:') as store:
                with self.assertRaisesRegex(SourceBlocked,'checksum differs'):
                    apply_western_acquisition(store,folder)
                self.assertEqual(store.db.execute('SELECT COUNT(*) FROM sources').fetchone()[0],0)


if __name__=='__main__':unittest.main()
