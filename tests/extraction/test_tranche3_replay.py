import importlib.util
from pathlib import Path
import unittest
from scripts.market_map.extraction_benchmark import benchmark, counts

spec=importlib.util.spec_from_file_location('tranche3_replay',Path(__file__).with_name('tranche3_replay.py'))
replay=importlib.util.module_from_spec(spec);spec.loader.exec_module(replay)

class Tranche3BenchmarkTests(unittest.TestCase):
    def test_final_synthetic_corpus_no_false_positives_or_wrong_edges(self):
        import json
        base=Path(__file__).with_name('tranche3_fixtures')
        run=benchmark(base/'manifest.json',base/'labels.jsonl')
        self.assertEqual((run['extraction']['email']['tp'],run['extraction']['email']['fp'],run['extraction']['email']['fn']),(15,0,0))
        labels=[json.loads(line) for line in (base/'labels.jsonl').read_text().splitlines()]
        expected={(r['id'],e['channel'],e['owner'],e['owner_pointer']) for r in labels for e in r['structured_attribution']}
        self.assertEqual(replay.structured_edges(run['predictions']),expected)
    def test_shared_or_unresolved_owner_does_not_score_as_assertion(self):
        row={'email':'desk@business.test','occurrences':[{'candidate_owner':{'ownership_status':'unresolved','candidate_owners':[{'name':'A','json_pointer':'/a'},{'name':'B','json_pointer':'/b'}]}}]}
        self.assertEqual(replay.structured_edges({'page':{'emails':[row]}}),set())
