import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from scripts.market_map.western_trade_rosters import inspect_trade_sources,inspect_linked_trade_controls


class TradeRosterRightsTests(unittest.TestCase):
    def test_recorded_publisher_holds_prevent_future_source_or_control_requests(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);output=root/'trade-roster-acquisition';output.mkdir()
            (output/'manifest.json').write_text(json.dumps({'status':'both_sources_held_at_exact_policy_review','no_further_access_to_these_routes':True,'company_factual_records_normalised':0}))
            with patch('scripts.market_map.western_trade_rosters.transport_for',side_effect=AssertionError('Must not open a transport for a held source')):
                for call in [inspect_trade_sources,inspect_linked_trade_controls]:
                    result=call(root)
                    self.assertEqual(result['fresh_http_requests'],0)
                    self.assertTrue(result['held_snapshot_reused'])


if __name__=='__main__':unittest.main()
