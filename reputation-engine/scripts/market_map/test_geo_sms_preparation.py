import base64
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from .geo_scaledmail_enrichment import prepare_geo_sms
from . import scaled_daily_preparation as scheduler


class GeoSmsPreparationTests(unittest.TestCase):
    def test_ottawa_scope_single_route_and_sensitive_sectors(self):
        now = datetime.now(timezone.utc)
        routing = {'route_id':'fixture', 'kind':'phone', 'technical_state':'canadian_mobile',
                   'carrier_checked_at':now.isoformat(), 'carrier_country':'CA', 'carrier_line_type':'mobile',
                   'carrier_number_valid':True, 'scope':'company'}
        cases = [
            ('Arnprior', 'bakery'), ('Ottawa', 'town_hall'), ('Carleton Place', 'dental_clinic'),
            ('Russell', 'hvac_service'), ('North Dundas', 'granite_supplier'),
            ('North Grenville', 'bakery'), ('Mississippi Mills', 'property_management'),
            ('Burlington', 'piercing'),
        ]
        rows = [{'id':str(i), 'city':city, 'sector':sector, 'name':f'Fixture {i}',
                 'verified_routes':[{**routing, 'value':f'+1613555000{i}'}]}
                for i,(city,sector) in enumerate(cases)]
        rows[-1]['verified_routes'].append({**routing,'route_id':'other','value':'+14035550000'})
        policy = Path(__file__).resolve().parents[2] / 'lib/partnership-core'
        prepared = prepare_geo_sms(rows, policy, at=now)
        self.assertEqual([row['id'] for row in prepared['drafts']], ['0','2','3'])
        self.assertTrue(all('Dexa Movers' in row['body'] and 'reply unsubscribe' in row['body'] and not row['holds']
                            for row in prepared['drafts']))
        self.assertEqual(prepared['holds'], {
            '1':['channel_or_role_review'], '4':['market_not_active'], '5':['market_not_active'],
            '6':['market_not_active'], '7':['primary_mobile_route_selection_required'],
        })

    def test_railway_requires_finished_carrier_and_calls_once_per_inventory_and_mode(self):
        day = '2026-11-22'
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / day
            results = folder / 'results'
            results.mkdir(parents=True)
            scheduler.save(results/'carrier-activation.json', {'pid':4321})
            scheduler.save(results/'verified-contact-inventory.json', {'items':['fixture']})
            prepared = {'drafts':[{'id':'fixture'}], 'inventory':[], 'template_version':'geo_b2b_intro_v1'}
            response = {'campaign_key':'geo-b2b-daily-20261122','prepared':1,'send_ready':1,'scheduled':0}
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value.read.return_value = json.dumps(response)
            config = {'geo_sms_promotion_endpoint':'https://go.quote2move.com/api/marketing/sms/promote-research',
                      'geo_sms_first_day':day}
            with patch.object(scheduler,'ROOT',root), patch.object(scheduler,'OUT',root), \
                 patch.object(scheduler,'muse_research_running',return_value=False), \
                 patch.object(scheduler,'enrichment_module',return_value=MagicMock(prepare_geo_sms=MagicMock(return_value=prepared))), \
                 patch.dict(scheduler.os.environ, WORKER_SHARED_SECRET='test-secret'), \
                 patch.object(scheduler.urllib.request,'build_opener',return_value=opener):
                scheduler.reconcile_daily_geo_sms(folder, config)
                opener.open.assert_not_called()
                scheduler.save(results/'carrier-review-status.json', {'state':'checked_available_capacity'})
                scheduler.reconcile_daily_geo_sms(folder, config)
                scheduler.reconcile_daily_geo_sms(folder, config)
                self.assertEqual(opener.open.call_count, 1)
                def posted():
                    wire = json.loads(opener.open.call_args.args[0].data)
                    self.assertEqual(wire['encoding'], 'gzip-base64')
                    return json.loads(gzip.decompress(base64.b64decode(wire['data'])))
                self.assertTrue(posted()['dry_run'])
                scheduler.reconcile_daily_geo_sms(folder,{**config,'geo_sms_auto_promotion':True})
                self.assertEqual(opener.open.call_count, 2)
                self.assertFalse(posted()['dry_run'])
