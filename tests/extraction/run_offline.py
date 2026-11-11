"""Run only explicitly reviewed pure tests. No production CLI discovery."""
import argparse
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path[:0] = [str(ROOT), str(ROOT / 'scripts'), str(ROOT / 'scripts/discovery_v2')]
from scripts.market_map.offline_guard import OfflineGuard

COMMON = ['tests/extraction/test_benchmark.py', 'tests/extraction/test_offline_guard.py',
          'tests/market_map/test_email_extraction.py', 'tests/market_map/test_phone_extraction.py',
          'tests/market_map/test_contact_context.py', 'tests/market_map/test_visible_contact_evidence.py']
TESTS = {'PR-00': COMMON, 'PR-01': COMMON + ['tests/extraction/test_phone_labels.py'],
         'PR-02': COMMON + ['tests/extraction/test_phone_labels.py', 'tests/extraction/test_phone_normalization.py',
                            'tests/market_map/test_phone_acquisition.py', 'tests/market_map/test_regional_identity_review.py',
                            'tests/market_map/test_regional_additional_phones.py']}
TESTS['PR-05'] = TESTS['PR-02'] + ['tests/extraction/test_email_normalization.py',
    'tests/market_map/test_structured_email_recovery.py', 'tests/market_map/test_structured_email_audit.py']
TESTS['PR-03'] = TESTS['PR-05'] + ['tests/market_map/test_phone_ingestion.py', 'tests/market_map/test_store.py',
    'tests/market_map/test_adapters.py', 'tests/market_map/test_reporting.py', 'tests/market_map/test_verification_pilot.py']
TESTS['PR-04'] = TESTS['PR-03'] + ['tests/discovery_v2/test_engine.py', 'tests/discovery_v2/test_worker.py',
    'tests/discovery_v2/test_overture.py', 'tests/discovery_v2/test_source_identity.py', 'tests/discovery_v2/test_identity_migration.py',
    'tests/extraction/test_tranche2_replay.py']

TESTS['PR-06'] = TESTS['PR-04'] + ['tests/extraction/test_email_occurrences.py']

TESTS['PR-07'] = TESTS['PR-06'] + ['tests/market_map/test_contact_observation_store.py', 'tests/market_map/test_email_persistence.py', 'tests/market_map/test_email_acquisition.py', 'tests/market_map/test_contact_enrichment.py']

TESTS['PR-08'] = TESTS['PR-07'] + ['tests/extraction/test_contact_text_runs.py']

TESTS['PR-09'] = TESTS['PR-08'] + ['tests/extraction/test_structured_contacts.py','tests/market_map/test_site_source_extract.py','tests/extraction/test_tranche3_replay.py']

TESTS['PR-10'] = TESTS['PR-09'] + ['tests/market_map/test_regional_email_inventory.py','tests/market_map/test_regional_occurrences.py']

TESTS['PR-11'] = TESTS['PR-10'] + ['tests/discovery_v2/test_contacts.py','tests/market_map/test_contact_attribution.py']

TESTS['PR-12'] = TESTS['PR-11'] + ['tests/market_map/test_transport.py','tests/market_map/test_transport_directory.py','tests/market_map/test_fetch_outcomes.py']

TESTS['PR-13'] = TESTS['PR-12'] + ['tests/market_map/test_frontier_retry.py']

TESTS['PR-14'] = TESTS['PR-13'] + ['tests/market_map/test_contact_frontier.py']

TESTS['PR-15'] = TESTS['PR-14'] + ['tests/market_map/test_contact_page.py','tests/market_map/test_regional_contact_daily.py']

TESTS['PR-16'] = TESTS['PR-15'] + ['tests/market_map/test_contact_capture.py','tests/market_map/test_source_capture_cache.py','tests/market_map/test_trusted_source_capture.py']

TESTS['PR-17'] = TESTS['PR-16'] + ['tests/extraction/test_release_gates.py','tests/extraction/test_release_operations.py']

TESTS['CORRECTIONS'] = TESTS['PR-17'] + ['tests/extraction/test_readiness_corrections.py']

def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--pr', choices=TESTS)
    group.add_argument('--all', action='store_true', help='All explicitly mapped implemented PR tests')
    args = parser.parse_args()
    files = sorted(set(sum(TESTS.values(), []))) if args.all else TESTS[args.pr]
    with tempfile.TemporaryDirectory(prefix='extraction-offline-') as directory:
        tempfile.tempdir = directory
        guard = OfflineGuard(directory)
        guard.install()
        suite = unittest.TestSuite()
        for i, filename in enumerate(files):
            spec = importlib.util.spec_from_file_location('offline_test_' + str(i), ROOT / filename)
            module = importlib.util.module_from_spec(spec)
            module.OFFLINE_GUARD = guard
            spec.loader.exec_module(module)
            suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        if guard.violations:
            print('Unexpected blocked IO:', guard.violations, file=sys.stderr)
        return 0 if result.wasSuccessful() and not guard.violations else 1


if __name__ == '__main__':
    raise SystemExit(main())
