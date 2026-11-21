import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('candidate', Path(__file__).resolve().parents[2] / 'staging/extraction-evaluation/prepare_production_candidate.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CandidateTests(unittest.TestCase):
    def fixture(self, root):
        baseline, snapshot = root / 'baseline', root / 'snapshot'
        entry = baseline / module.PROTECTED
        entry.parent.mkdir(parents=True)
        entry.write_text('# original entrypoint')
        (baseline / 'customer.sqlite').write_bytes(b'never copy')
        page = snapshot / 'scripts/parser.py'
        page.parent.mkdir(parents=True)
        page.write_text('# candidate parser')
        (snapshot / 'staging-manifest.json').write_text(json.dumps({'scripts/parser.py': module.digest(page.read_bytes())}))
        return baseline, snapshot

    def test_preserves_baseline_and_omits_deployable_configuration_and_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); baseline, snapshot = self.fixture(root)
            before = (baseline / module.PROTECTED).read_bytes()
            result = module.prepare(baseline, snapshot, root / 'candidate')
            self.assertTrue(result['entrypoint_preserved'])
            self.assertFalse(result['deployable'])
            self.assertEqual(before, (baseline / module.PROTECTED).read_bytes())
            self.assertFalse((root / 'candidate/customer.sqlite').exists())
            self.assertFalse((root / 'candidate/Dockerfile').exists())
            with self.assertRaises(ValueError):module.prepare(baseline, snapshot, root / 'candidate')

    def test_rejects_tampered_snapshot_before_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); baseline, snapshot = self.fixture(root)
            (snapshot / 'scripts/parser.py').write_text('tampered')
            with self.assertRaises(ValueError):module.prepare(baseline, snapshot, root / 'candidate')
            self.assertFalse((root / 'candidate').exists())

    def test_rejects_traversal_symlink_and_entrypoint_overlay(self):
        for case in ('traversal', 'symlink', 'entrypoint'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); baseline, snapshot = self.fixture(root)
                name = '../outside.py' if case == 'traversal' else module.PROTECTED if case == 'entrypoint' else 'scripts/link.py'
                path = snapshot / name;path.parent.mkdir(parents=True, exist_ok=True)
                if case == 'symlink':path.symlink_to(snapshot / 'scripts/parser.py')
                else:path.write_text('# forbidden')
                (snapshot / 'staging-manifest.json').write_text(json.dumps({name: module.digest(path.read_bytes())}))
                with self.assertRaises(ValueError):module.prepare(baseline, snapshot, root / 'candidate')
                self.assertFalse((root / 'candidate').exists())

if __name__ == '__main__':unittest.main()
