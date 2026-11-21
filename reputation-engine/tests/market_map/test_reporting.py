import csv
import gzip
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.geography import seed_geographies, resolve_geography
from market_map.reporting import coverage_report, export_all, load_taxonomy, blocked_source_handoff, _write_dataset, _source_age, _resource_summary
from market_map.store import MarketMap


class ReportingTests(unittest.TestCase):
    def setUp(self):
        self.store = MarketMap(":memory:")
        seed_geographies(self.store)
        london = resolve_geography(self.store, "London")
        self.store.db.execute("DELETE FROM geography_service_areas WHERE geography_id<>?", (london,))
        self.store.db.commit()
        self.source = self.store.upsert_source({"id": "fixture-directory", "name": "Fixture municipal directory", "source_url": "https://directory.test", "source_type": "municipal_directory", "geography_scope": ["london"], "sector_scope": ["*"], "rights_status": "permitted", "retrieval_status": "accessible"})

    def tearDown(self):
        self.store.close()

    def ingest(self, **overrides):
        row = {"name": "Example Office", "city": "London", "address": "10 Fixture Road", "source_record_id": "1", "source_url": "https://directory.test/1", **overrides}
        return self.store.ingest(self.source, [row], run_metadata={"status": "completed", "coverage_complete": True, "requests": 2, "bytes_fetched": 240, "estimated_cost": 0})

    def test_broad_directory_run_does_not_complete_sector_or_invent_buying_intent(self):
        self.ingest()
        report = coverage_report(self.store)
        broad = next(c for c in report["cells"] if c["sector_id"] == "*" and c["source_lane"] == "municipal_directory")
        niche = next(c for c in report["cells"] if c["sector_id"] == "sports" and c["source_lane"] == "municipal_directory")
        self.assertEqual(broad["search_status"], "ingested")
        self.assertEqual(niche["search_status"], "source_identified")
        self.assertEqual(niche["unique_organisations"], 0)
        self.assertTrue(all(c["market_completeness_percentage"] is None for c in report["cells"]))
        self.assertEqual(report["counts"]["unclassified_organisations"], 1)
        self.assertEqual(report["run_costs"]["requests"], 2)

    def test_source_geography_does_not_fabricate_local_physical_presence(self):
        self.ingest(city="Toronto", address="50 Out Of Area Road")
        report = coverage_report(self.store)
        self.assertEqual(report["counts"]["organisations"], 1)
        self.assertEqual(report["footprint"][0]["unique_locations"], 0)
        self.assertTrue(all(c["unique_locations"] == 0 for c in report["cells"]))

    def test_uninstrumented_cloud_metrics_remain_unknown_with_known_subtotals(self):
        self.ingest()
        self.store.ingest(self.source, [{'name': 'Cloud Fixture', 'city': 'London', 'address': '20 Fixture Street', 'source_record_id': 'cloud'}],
            run_metadata={'requests': None, 'bytes_fetched': None, 'request_count_known': False, 'transfer_bytes_known': False})
        costs = coverage_report(self.store)['run_costs']
        self.assertIsNone(costs['requests'])
        self.assertIsNone(costs['bytes_fetched'])
        self.assertEqual(costs['requests_known_total'], 2)
        self.assertEqual(costs['bytes_fetched_known_total'], 240)
        self.assertEqual(costs['requests_unknown_run_count'], 1)
        with tempfile.TemporaryDirectory() as folder:
            export_all(self.store, folder)
            runs = [json.loads(line) for line in (Path(folder) / 'source_runs.jsonl').read_text().splitlines()]
            unknown = next(row for row in runs if not row['request_count_known'])
            self.assertIsNone(unknown['requests'])
            self.assertIsNone(unknown['bytes_fetched'])
            self.assertEqual(unknown['stored_requests'], 0)

    def test_chunk_import_does_not_multiply_original_acquisition_runtime(self):
        runs = [{'requests': 0, 'bytes_fetched': 0, 'runtime_seconds': 5, 'metadata_json': json.dumps({'original_acquisition_manifest': 'same-file', 'original_acquisition_elapsed_seconds': 5})} for _ in range(3)]
        self.assertEqual(_resource_summary(runs)['runtime_seconds'], 5)

    def test_recovery_prefix_and_final_cumulative_meters_count_once_per_source_acquisition(self):
        runs = [{'source_id': 'A', 'requests': count, 'bytes_fetched': count * 100, 'runtime_seconds': count,
                 'estimated_cost': count / 100, 'metadata_json': json.dumps({'acquisition_id': 'same-http-invocation'})} for count in [5, 8]]
        costs = _resource_summary(runs)
        self.assertEqual(costs['requests_known_total'], 8)
        self.assertEqual(costs['bytes_fetched_known_total'], 800)
        self.assertEqual(costs['runtime_seconds'], 8)
        self.assertEqual(costs['estimated_paid_cost'], .08)
        self.assertEqual(costs['resource_acquisition_groups'], 1)
        independent = [{**r, 'metadata_json': '{}'} for r in runs]
        self.assertEqual(_resource_summary(independent)['requests_known_total'], 13)

    def test_source_reference_precision_and_age_are_separate_from_fresh_acquisition(self):
        fixed = datetime(2026, 10, 26, tzinfo=timezone.utc)
        year = _source_age('2025', fixed, 90)
        self.assertEqual(year['source_date_precision'], 'year')
        self.assertIsNone(year['source_data_age_days'])
        self.assertLess(year['source_data_age_days_min'], year['source_data_age_days_max'])
        month = _source_age('2025-12', fixed, 90)
        self.assertEqual(month['source_date_precision'], 'month')
        self.assertIsNone(month['source_data_age_days'])
        self.assertEqual(_source_age('2026-10-21', fixed, 30)['source_data_age_days'], 5)
        self.assertEqual(_source_age('1707992793000', fixed, 30)['source_date_precision'], 'unknown')
        self.ingest()
        self.store.db.execute("UPDATE sources SET source_date='2024-02-15'")
        self.store.db.commit()
        source = coverage_report(self.store)['source_statuses'][0]
        self.assertFalse(source['stale_source'])
        self.assertEqual(source['source_data_age_warning'], 'underlying_reference_date_older_than_refresh_interval')

    def test_evidence_only_excerpt_does_not_replace_collection_status_or_age(self):
        self.ingest()
        self.store.record_evidence(self.source, {"excerpt": "Example Office has a named client"}, source_url="https://directory.test/client", observed_at="2026-10-26T23:00:00Z")
        self.store.db.commit()
        self.assertEqual(coverage_report(self.store)["source_statuses"][0]["status"], "ingested")
        self.store.db.execute("UPDATE source_runs SET started_at='2020-01-01T00:00:00Z' WHERE status='completed'")
        self.store.db.commit()
        self.assertEqual(coverage_report(self.store)["source_statuses"][0]["status"], "stale")

    def test_explicit_industry_counts_retained_separately_and_stale_visible(self):
        self.ingest(categories=["sports"], taxonomy="ssm_industry_family")
        report = coverage_report(self.store)
        sports = next(c for c in report["cells"] if c["sector_id"] == "sports" and c["source_lane"] == "municipal_directory")
        self.assertEqual(sports["unique_organisations"], 1)
        self.assertEqual(sports["search_status"], "partially_ingested")
        self.store.db.execute("UPDATE source_runs SET started_at='2020-01-01T00:00:00Z',completed_at='2020-01-01T00:00:00Z'")
        self.store.db.execute("UPDATE sources SET last_success_at='2020-01-01T00:00:00Z'")
        self.store.db.commit()
        self.assertEqual(coverage_report(self.store)["source_statuses"][0]["status"], "stale")

    def test_exports_preserve_ids_evidence_suppression_and_original_json_values(self):
        self.ingest(name="=1+1", email="public@example.test", phone="5195550100")
        self.store.db.execute("UPDATE contact_channels SET suppression_status='suppressed',outreach_eligibility='ineligible'")
        self.store.db.commit()
        with tempfile.TemporaryDirectory() as folder:
            manifest = export_all(self.store, folder)
            path = Path(folder)
            accounts = [json.loads(line) for line in (path / "accounts.jsonl").read_text().splitlines()]
            organisations = [json.loads(line) for line in (path / "organisations.jsonl").read_text().splitlines()]
            locations = [json.loads(line) for line in (path / "locations.jsonl").read_text().splitlines()]
            evidence = {json.loads(line)["id"] for line in (path / "evidence.jsonl").read_text().splitlines()}
            self.assertEqual(accounts[0]["organisation_id"], organisations[0]["id"])
            self.assertEqual(locations[0]["organisation_id"], organisations[0]["id"])
            self.assertTrue(set(accounts[0]["evidence_ids"]) <= evidence)
            self.assertEqual(accounts[0]["trading_name"], "=1+1")
            self.assertFalse(accounts[0]["campaign_ready"])
            self.assertTrue(accounts[0]["suppressed_channel_present"])
            self.assertEqual(manifest["datasets"]["campaign_ready"]["rows"], 0)
            with (path / "accounts.csv").open() as handle:
                self.assertEqual(next(csv.DictReader(handle))["trading_name"], "'=1+1")
            self.assertEqual(manifest["datasets"]["locations"]["rows"], 1)
            self.assertTrue((path / "COVERAGE-REPORT.md").exists())
            self.assertTrue((path / 'raw_payloads.jsonl.gz').exists())
            with gzip.open(path / 'raw_payloads.jsonl.gz', 'rt') as handle:
                raw_payload = json.loads(next(handle))
                self.assertEqual(raw_payload['payload']['name'], '=1+1')

    def test_large_streamed_export_is_lossless_compressed_without_plain_duplicates(self):
        with tempfile.TemporaryDirectory() as folder:
            result = _write_dataset(Path(folder), 'large-fixture', ({'id': n, 'name': f'Fixture {n}'} for n in range(25000)),
                                    ['id', 'name'], expected_count=25000)
            self.assertEqual(result['rows'], 25000)
            self.assertEqual(result['compression'], 'gzip')
            self.assertFalse((Path(folder) / 'large-fixture.csv').exists())
            self.assertFalse((Path(folder) / 'large-fixture.jsonl').exists())
            with gzip.open(Path(folder) / result['jsonl'], 'rt') as handle:
                rows = [json.loads(line) for line in handle]
            self.assertEqual(rows[-1], {'id': 24999, 'name': 'Fixture 24999'})

    def test_taxonomy_keeps_industry_opportunity_role_and_capability_separate(self):
        taxonomy = load_taxonomy()
        self.assertEqual(len(taxonomy["industry_families"]), 20)
        self.assertIn("supplier", taxonomy["account_roles"])
        self.assertEqual(taxonomy["service_opportunity_default_status"], "hypothesis")
        self.assertEqual(taxonomy["fulfilment_default"], "scope_unknown")

    def test_mail_virtual_and_programme_routes_are_retained_without_physical_site_claims(self):
        rows = [{'source_record_id': kind, 'name': 'Fixture ' + kind, 'city': 'London', 'address': f'{n} Fixture Road', 'location_type': kind}
                for n, kind in enumerate(['mailing_address', 'virtual', 'programme', 'unknown'], 1)]
        self.store.ingest(self.source, rows)
        counts = coverage_report(self.store)['counts']
        self.assertEqual(counts['locations'], 4)
        self.assertEqual(counts['mail_route_location_records'], 1)
        self.assertEqual(counts['virtual_location_records'], 1)
        self.assertEqual(counts['programme_location_records'], 1)
        self.assertEqual(counts['physical_site_candidate_records'], 1)
        with tempfile.TemporaryDirectory() as folder:
            manifest = export_all(self.store, folder)
            self.assertEqual(manifest['datasets']['locations']['rows'], 4)
            with (Path(folder) / 'city-summary.csv').open() as handle:
                city = next(csv.DictReader(handle))
            self.assertEqual(city['mail_route_location_records'], '1')
            self.assertEqual(city['physical_site_candidate_records'], '1')

    def test_business_view_excludes_only_explicit_nonorganisation_flags_retains_unknowns_and_full_evidence(self):
        from market_map.classify import classify
        self.ingest(name='Fixture Park', categories=['park'], taxonomy='Overture Places', entity_type='place_candidate')
        self.store.ingest(self.source, [{'name': 'Unclassified Fixture', 'source_record_id': 'unknown', 'city': 'London', 'address': '20 Fixture Street'}])
        classify(self.store)
        counts = coverage_report(self.store)['counts']
        self.assertEqual(counts['organisations'], 2)
        self.assertEqual(counts['explicit_non_organisation_place_candidates'], 1)
        self.assertEqual(counts['business_or_organisation_candidate_records'], 1)
        with tempfile.TemporaryDirectory() as folder:
            manifest = export_all(self.store, folder)
            raw_accounts = [json.loads(line) for line in (Path(folder) / 'accounts.jsonl').read_text().splitlines()]
            candidates = [json.loads(line) for line in (Path(folder) / 'business-organisation-candidates.jsonl').read_text().splitlines()]
            self.assertEqual(len(raw_accounts), 2)
            self.assertEqual(len(candidates), 1)
            self.assertEqual(candidates[0]['trading_name'], 'Unclassified Fixture')
            park = next(row for row in raw_accounts if row['trading_name'] == 'Fixture Park')
            self.assertEqual(park['discovery_context_flags'], ['non_organisation_place_candidate'])
            self.assertFalse(park['business_or_organisation_candidate_view_eligible'])
            self.assertTrue(park['evidence_ids'])
            self.assertEqual(manifest['datasets']['organisations']['rows'], 2)

    def test_blocked_handoff_includes_real_links_errors_and_permission_conflicts_only(self):
        self.store.upsert_source({"id": "unsearched", "name": "Unsearched source", "source_url": "https://unsearched.test", "rights_status": "unreviewed"})
        self.store.upsert_source({"id": "blocked", "name": "Blocked export", "source_url": "https://blocked.test/directory", "retrieval_status": "forbidden", "rights_status": "unverified", "notes": "Export returned HTTP403"})
        self.store.record_run_failure("blocked", "HTTP403 at published export", status="blocked")
        self.store.upsert_source({"id": "conflict", "name": "Competing licence metadata", "source_url": "https://conflict.test", "rights_status": "permitted", "config": {"licence_conflict": True}})
        rows = blocked_source_handoff(self.store)
        self.assertEqual({r["source_id"] for r in rows}, {"blocked", "conflict"})
        blocked = next(r for r in rows if r['source_id'] == 'blocked')
        self.assertEqual(blocked['source_url'], 'https://blocked.test/directory')
        self.assertIn('HTTP403', blocked['latest_recorded_error'])
        self.assertTrue(all(not r['automatic_bypass_authorized'] for r in rows))
        self.assertFalse(next(r for r in rows if r['source_id'] == 'conflict')['bulk_reuse_permission_confirmed'])


if __name__ == "__main__":
    unittest.main()
