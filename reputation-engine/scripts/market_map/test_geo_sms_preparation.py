import base64
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import MagicMock, patch

from .geo_scaledmail_enrichment import prepare_geo_sms
from . import geo_contact_carrier_checks as carrier
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
        self.assertTrue(all('Dexa Movers' in row['body'] and 'unsubscribe' not in row['body'].lower() and row['body'] == row['body'].strip() and row['body'].count('\n\n') == 2 and not row['holds']
                            for row in prepared['drafts']))
        self.assertEqual(prepared['holds'], {
            '1':['channel_or_role_review'], '4':['market_not_active'], '5':['market_not_active'],
            '6':['market_not_active'], '7':['primary_mobile_route_selection_required'],
        })

    def test_carrier_requires_current_valid_canadian_wireless_and_no_route_failure(self):
        now = datetime.now(timezone.utc)
        number = '+14165550123'
        for kind, valid, country, extra, allowed in [
            ('mobile', True, 'CA', {}, True),
            ('wireless', True, 'CA', {}, True),
            ('landline', True, 'CA', {}, False),
            ('voip', True, 'CA', {}, False),
            ('toll_free', True, 'CA', {}, False),
            ('mobile', True, 'CA', {'sms_capable':False}, False),
            ('mobile', True, 'CA', {'error_code':'unresolved'}, False),
            ('mobile', True, 'CA', {'mobile_country_code':'310'}, False),
            ('mobile', True, 'CA', {'mobile_country_code':'302'}, True),
            ('mobile', 'true', 'CA', {}, False),
            ('mobile', True, 'US', {}, False),
        ]:
            with self.subTest(kind=kind, extra=extra):
                entry={'checked_at':now.isoformat(), 'data':{'valid_number':valid,'country_code':country,'phone_number':number,
                                                           'carrier':{'type':kind, **extra}}}
                result=carrier.classify({number:entry}, '(416) 555-0123', now)
                self.assertEqual(result['technical_state']=='canadian_mobile', allowed)
                if allowed:
                    self.assertEqual(result['carrier_line_type'], 'mobile')

    def test_provider_receipt_overrides_stale_inventory_and_replay_preserves_lookup(self):
        now = datetime.now(timezone.utc)
        number='+14165550123'
        entry={'checked_at':now.isoformat(), 'data':{'valid_number':True,'country_code':'CA','phone_number':number,'carrier':{'type':'mobile'}}}
        cache={number:entry.copy()}
        receipt={'code':'30006','provider':'twilio','provider_event_id':'test-event',
                 'provider_message_key':'SMfixture','observed_at':now.isoformat(),'campaign_key':'fixture'}
        self.assertEqual(carrier.record_delivery_route_holds(cache, {number:receipt}), 1)
        self.assertEqual(carrier.record_delivery_route_holds(cache, {number:receipt}), 0)
        self.assertEqual(cache[number]['data'], entry['data'])
        with self.assertRaises(ValueError):
            carrier.record_delivery_route_holds(cache, {number:{**receipt,'code':'30003'}})
        with TemporaryDirectory() as tmp:
            root=Path(tmp)
            target=root/carrier.CARRIER_DIRECTORY/'carrier-lookups.json'
            target.parent.mkdir(parents=True)
            carrier.save(target, cache)
            policy=Path(__file__).resolve().parents[2]/'lib/partnership-core'
            route={'route_id':'mobile','kind':'phone','value':number,'scope':'company',
                   **carrier.classify({number:entry}, number, now)}
            items=[{'id':'fixture','name':'Fixture Bakery','city':'Toronto','sector':'bakery',
                    'verified_routes':[route]}]
            with patch.object(scheduler,'ROOT',root), patch.object(carrier,'refresh_delivery_holds'):
                self.assertEqual(len(prepare_geo_sms(items, policy, at=now)['drafts']), 1)
                result=prepare_geo_sms(scheduler.refresh_sms_carrier_inventory(items), policy, at=now)
                self.assertEqual(result['drafts'], [])
                self.assertEqual(route['technical_state'], 'carrier_sms_unroutable')

    def test_rejects_us_and_mismatched_lookup_even_when_marked_mobile(self):
        now=datetime.now(timezone.utc)
        number='+14165550123'
        us='+12125550123'
        row={'checked_at':now.isoformat(),'data':{'valid_number':True,'country_code':'CA',
            'phone_number':number,'carrier':{'type':'mobile','mobile_country_code':'302'}}}
        self.assertEqual(carrier.classify({us:row},us,now)['technical_state'],'carrier_non_canadian_numbering')
        self.assertNotEqual(carrier.classify({number:{**row,'data':{**row['data'],'phone_number':us}}},number,now)['technical_state'],'canadian_mobile')
        self.assertNotEqual(carrier.classify({number:{**row,'data':{**row['data'],'phone_number':None}}},number,now)['technical_state'],'canadian_mobile')

    def test_final_provider_failures_are_reconciled_by_exact_route(self):
        now=datetime.now(timezone.utc)
        with TemporaryDirectory() as tmp:
            root=Path(tmp)
            config=root/'.private'
            config.mkdir()
            carrier.save(config/'regional-outcomes.json', {'SUPABASE_URL':'https://example.test','SUPABASE_KEY':'fixture',
                         'TWILIO_ACCOUNT_SID':'AC'+'a'*32,'TWILIO_AUTH_TOKEN':'fixture'})
            folder=root/carrier.CARRIER_DIRECTORY
            folder.mkdir(parents=True)
            sid='SM'+'1'*32
            calls=[]
            def provider(request, **_kwargs):
                calls.append(request.full_url)
                path=request.full_url.split('?')[0]
                if path.endswith('crm_sms_provider_events'):
                    body=[{'event_id':'telnyx-1','provider':'telnyx','message_key':'telnyx:fixture',
                           'occurred_at':now.isoformat(),'payload':{'errors':[{'code':'40001'}],'to':[{'phone_number':'+14165550123'}]}}]
                else:
                    body={'messages':[{'sid':sid,'error_code':30006,'status':'undelivered','direction':'outbound-api',
                                       'date_updated':'Mon, 23 Nov 2026 04:00:00 +0000','to':'+15195550123'},
                                      {'sid':'SMtemporary','error_code':30003,'status':'undelivered','direction':'outbound-api',
                                       'date_updated':'Mon, 23 Nov 2026 04:00:00 +0000','to':'+15195550124'}]}
                response=MagicMock()
                response.__enter__.return_value.read.return_value=json.dumps(body)
                return response
            with patch.object(carrier,'urlopen',side_effect=provider):
                carrier.refresh_delivery_holds(root, now)
                carrier.refresh_delivery_holds(root, now)
            self.assertEqual(len(calls),2)
            cache=carrier.read(folder/'carrier-lookups.json',{})
            self.assertEqual(set(cache),{'+14165550123','+15195550123'})
            self.assertEqual(cache['+14165550123']['sms_delivery_hold']['code'],'40001')
            self.assertEqual(cache['+15195550123']['sms_delivery_hold']['code'],'30006')

    def test_provider_lookups_have_no_balance_request_and_keep_the_daily_cap(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            private = root/'.private'
            private.mkdir()
            carrier.save(private/'contact-verification.json', {'TELNYX_API_KEY':'test-key'})
            cache = root/'cache.json'
            ledger = root/'ledger.json'
            receipt = root/'status.json'
            summary = {'provider_attempts':0,'provider_errors':0}
            response = MagicMock()
            response.__enter__.return_value.read.return_value = json.dumps({'data':{
                'valid_number':True,'country_code':'CA','carrier':{'type':'mobile'},
            }})
            with patch.object(carrier,'urlopen',return_value=response) as provider:
                carrier._lookup(root, ['+14165550123','+14165550124'], cache, ledger, receipt, 1, summary)
            self.assertEqual(provider.call_count, 1)
            self.assertIn('/v2/number_lookup/', provider.call_args.args[0].full_url)
            self.assertEqual(summary['provider_attempts'], 1)
            self.assertEqual(summary['state'], 'shared_daily_carrier_capacity_reached')

    def test_railway_requires_finished_carrier_and_calls_once_per_inventory_and_mode(self):
        day = '2026-11-22'
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / day
            results = folder / 'results'
            results.mkdir(parents=True)
            scheduler.save(results/'carrier-activation.json', {'pid':4321})
            scheduler.save(results/'verified-contact-inventory.json', {'items':[{'id':'fixture', 'verified_routes':[]}]})
            prepared = {'drafts':[{'id':'fixture'}], 'inventory':[], 'template_version':'geo_b2b_intro_v1'}
            response = {'campaign_key':'geo-b2b-daily-20261122','prepared':1,'send_ready':1,'scheduled':0}
            opener = MagicMock()
            opener.open.return_value.__enter__.return_value.read.return_value = json.dumps(response)
            config = {'geo_sms_promotion_endpoint':'https://go.quote2move.com/api/marketing/sms/promote-research',
                      'geo_sms_first_day':day}
            with patch.object(scheduler,'ROOT',root), patch.object(scheduler,'OUT',root), \
                 patch.object(carrier,'refresh_delivery_holds'), \
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
