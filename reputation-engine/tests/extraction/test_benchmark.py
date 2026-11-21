import copy
import json
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.extraction_benchmark import (benchmark, compare_runs, counts, load_manifest,
                                                    score_attribution, score_extraction, stable, analyze_errors, ERROR_CATEGORIES)

FIXTURES = Path(__file__).parent / 'fixtures'


class BenchmarkTests(unittest.TestCase):
    def test_errors_do_not_invent_causes_and_keep_hypotheses_separate(self):
        gold={'a':{'emails':['missing@business.test'],'phones':[],'attribution':[],'attribution_known':True}}
        predicted={'a':{'emails':[],'phones':[],'attribution':[]}}
        self.assertEqual(analyze_errors(predicted,gold)[0]['category'], 'Unknown or insufficient evidence')
        gold['a']['error_evidence']=[{'channel':'email','value':'missing@business.test','outcome':'false_negative',
            'category':'HTML/DOM extraction failure','basis':'hypothesis','evidence':'May span text nodes; not traced'}]
        row=analyze_errors(predicted,gold)[0]
        self.assertEqual(row['basis'],'insufficient_evidence');self.assertEqual(len(row['hypotheses']),1)
        for category in ERROR_CATEGORIES:
            gold['a']['error_evidence'][0].update(category=category,basis='observed',evidence='Controlled fixture trace')
            self.assertEqual(analyze_errors(predicted,gold)[0]['category'],category)

    def test_phone_kind_and_acquisition_failure_have_direct_evidence(self):
        gold={'a':{'emails':['a@business.test'],'phones':[{'phone':'+15195550123','extension':'','kind':'fax'}],'attribution':[],'attribution_known':True}}
        pred={'a':{'emails':[],'phones':[{'phone':'+15195550123','extension':'','kind':'phone'}],'attribution':[],
                   'acquisition_status':'failed','acquisition_error':{'status':503,'fixture':True}}}
        errors=analyze_errors(pred,gold)
        self.assertEqual(len(errors),3)
        self.assertEqual([r['category'] for r in errors],['Acquisition or crawl failure','Incorrect channel type','Incorrect channel type'])

    def test_hand_calculated_metrics_and_empty_denominators(self):
        self.assertEqual(counts({1, 2}, {2, 3}), {'tp': 1, 'fp': 1, 'fn': 1, 'precision': .5, 'recall': .5, 'f1': .5})
        self.assertIsNone(counts(set(), set())['precision'])

    def test_replay_deterministic_and_safeguards_unchanged(self):
        first = benchmark(FIXTURES / 'manifest.json', FIXTURES / 'labels.jsonl')
        self.assertEqual(stable(first), stable(benchmark(FIXTURES / 'manifest.json', FIXTURES / 'labels.jsonl')))
        for page in first['predictions'].values():
            for row in page['phones'] + page['emails']:
                self.assertEqual(row['outreach_eligibility'], 'research_only')
                self.assertTrue(row['page_content_sha256'])

    def test_wrong_owner_does_not_count_as_extraction_failure(self):
        labels = {'a': {'emails': ['desk@shared.test'], 'phones': [], 'attribution_known': True,
                        'attribution': [{'channel': 'desk@shared.test', 'owner': 'Alpha', 'relation': 'person_card'}]}}
        results = {'a': {'emails': [{'email': 'desk@shared.test'}], 'phones': [],
                         'attribution': [{'channel': 'desk@shared.test', 'owner': 'Beta', 'relation': 'person_card'}]}}
        self.assertEqual(score_extraction(results, labels)['email']['tp'], 1)
        scored = score_attribution(results, labels)
        self.assertEqual((scored['tp'], scored['fp'], scored['fn']), (0, 1, 1))
        labels['a']['attribution_known'] = False
        self.assertEqual(score_attribution(results, labels)['unscored_unknown_owner_predictions'], 1)

    def test_diff_retains_removed_raw_observation(self):
        before = {'a': {'phones': [{'phone': '+11234567890', 'raw_value': 'tel:+11234567890'}]}}
        changed = compare_runs(before, {'a': {'phones': []}})
        self.assertEqual(changed[0]['before'][0]['raw_value'], 'tel:+11234567890')
        self.assertEqual(changed[0]['after'], [])

    def test_hash_approval_duplicate_and_missing_owner_validation(self):
        original = json.loads((FIXTURES / 'manifest.json').read_text())
        labels = [json.loads(line) for line in (FIXTURES / 'labels.jsonl').read_text().splitlines()]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for source in FIXTURES.glob('*.html'):
                (root / source.name).write_bytes(source.read_bytes())
            for case in ('hash', 'approval', 'duplicate_capture', 'duplicate_label', 'owner', 'path'):
                manifest, rows = copy.deepcopy(original), copy.deepcopy(labels)
                if case == 'hash': manifest['pages'][0]['sha256'] = 'wrong'
                if case == 'approval': manifest['pages'][0]['approval'] = 'public_is_permission'
                if case == 'duplicate_capture': manifest['pages'].append(manifest['pages'][0])
                if case == 'duplicate_label': rows.append(rows[0])
                if case == 'owner': rows[-3]['attribution'][0]['owner'] = ''
                if case == 'path': manifest['pages'][0]['file'] = '../outside.html'
                (root / 'manifest.json').write_text(stable(manifest))
                (root / 'labels.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows))
                with self.subTest(case=case), self.assertRaises(ValueError):
                    load_manifest(root / 'manifest.json', root / 'labels.jsonl')
