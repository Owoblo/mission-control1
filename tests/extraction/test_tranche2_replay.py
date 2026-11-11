import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('tranche2_replay', Path(__file__).with_name('tranche2_replay.py'))
replay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(replay)


class ReplayContractTests(unittest.TestCase):
    def test_partial_unicode_address_is_inspectable_error(self):
        row = {'raw': 'élise@fictional.test', 'normalized': None,
               'extracted': [{'email': 'lise@fictional.test'}]}
        error = replay.score_contract('email', [row])[0]
        self.assertEqual(error['category'], 'Normalization error')
        self.assertEqual(error['basis'], 'observed')
        self.assertEqual(error['source_record']['raw'], row['raw'])
        self.assertEqual(error['hypotheses'], [])

    def test_missing_raw_phone_contract_is_failure(self):
        row = {'raw': '5195550123', 'channels': [{'value': '+15195550123'}]}
        self.assertEqual(len(replay.score_contract('phone', [row])), 1)
        row['phone_observations'] = [{'raw_value': row['raw'], 'extension': '', 'format_status': 'normalized'}]
        self.assertEqual(replay.score_contract('phone', [row]), [])

    def test_correct_identity_abstention_is_not_failure(self):
        row = {'case': 'ambiguous_missing', 'entities': [],
               'result': {'conflicts': 0, 'unresolved_rows': 2}}
        self.assertEqual(replay.score_contract('identity', [row]), [])
