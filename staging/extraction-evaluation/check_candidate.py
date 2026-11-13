"""Guarded tests of a source-only production compatibility candidate."""
import argparse
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    args = parser.parse_args()
    candidate = Path(args.candidate).resolve()
    workspace = Path(__file__).resolve().parents[2]
    sys.dont_write_bytecode = True
    sys.path[:0] = [str(candidate), str(candidate / 'scripts'), str(candidate / 'scripts/discovery_v2')]
    from scripts.market_map.offline_guard import OfflineGuard
    mapping = load('candidate_mapping', candidate / 'tests/extraction/run_offline.py')
    files = [candidate / name for name in mapping.TESTS['CORRECTIONS']]
    files += [workspace / 'tests/market_map/test_railway_research.py',
              workspace / 'tests/extraction/test_production_candidate.py']
    with tempfile.TemporaryDirectory(prefix='production-compatibility-') as folder:
        tempfile.tempdir = folder
        guard = OfflineGuard(folder)
        guard.install()
        suite = unittest.TestSuite()
        for index, file in enumerate(files):
            spec = importlib.util.spec_from_file_location('compatibility_test_' + str(index), file)
            module = importlib.util.module_from_spec(spec)
            module.OFFLINE_GUARD = guard
            spec.loader.exec_module(module)
            suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        if guard.violations:
            print('Unexpected blocked IO:', guard.violations, file=sys.stderr)
        return 0 if result.wasSuccessful() and not guard.violations else 1


if __name__ == '__main__':sys.exit(main())
