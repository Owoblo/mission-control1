import unittest
import tempfile
from pathlib import Path
from scripts.market_map.store import MarketMap, stable_id, phone_number
from scripts.market_map.adapters import normalize
from scripts.market_map.phone_extraction import normalize_phone
from scripts.market_map.reporting import _accounts


class PhoneIngestionTests(unittest.TestCase):
    def setUp(self):
        self.store=MarketMap(':memory:')
        self.source={'id':'fixture','name':'Fixture','source_url':'https://directory.test/'}
        self.sid=self.store.upsert_source(self.source)
    def tearDown(self): self.store.close()
    def ingest(self, **values):
        return self.store.ingest(self.sid,[{'name':'Fictional Office','source_record_id':'one','source_url':self.source['source_url'],**values}])
    def rows(self, table): return [dict(r) for r in self.store.db.execute('SELECT * FROM '+table)]

    def test_invalid_and_unsupported_are_evidence_not_channels(self):
        self.ingest(published_phones=['Phone unavailable','+11234567890','++442079460123'])
        self.assertEqual(self.rows('contact_channels'),[])
        observations=self.rows('phone_observations')
        self.assertEqual({r['format_status'] for r in observations},{'invalid','unsupported'})
        self.assertTrue(all(r['channel_id'] is None for r in observations))
        self.assertEqual({r['raw_value'] for r in observations},{'Phone unavailable','+11234567890','++442079460123'})

    def test_adapter_store_and_extractor_share_contract(self):
        for value in ['+4422345678','tel:5195550123;ext=09','Phone unavailable','+11234567890']:
            mapped=normalize({'id':value,'name':value,'phone':value},self.source,observed_at='2026-01-01')
            self.store.ingest(self.sid,[mapped])
            expected=normalize_phone(value)
            self.assertEqual(mapped['phone'],expected[0] if expected else '')
            self.assertEqual(mapped['phone_raw'],value)
            self.assertEqual(phone_number(value),expected[0] if expected else None)
        self.assertEqual(len(self.rows('contact_channels')),2)

    def test_extensions_fax_and_replay_remain_distinct(self):
        values={'published_phones':[{'phone':'+15195550123','extension':'01'}, {'raw_value':'5195550123 x02'},
                                  {'phone':'+15195550123','kind':'fax'}]}
        self.ingest(**values);self.ingest(**values)
        self.assertEqual(len(self.rows('contact_channels')),3)
        self.assertEqual({r['extension'] for r in self.rows('phone_channel_details')},{'01','02',''})
        self.assertEqual({r['channel_type'] for r in self.rows('contact_channels')},{'phone','fax'})
        self.assertTrue(all(r['outreach_eligibility']=='research_only' for r in self.rows('contact_channels')))

    def test_conflicting_extension_does_not_become_callable(self):
        self.ingest(published_phones=[{'raw_value':'5195550123 x01','extension':'02'}])
        self.assertEqual(self.rows('contact_channels'),[])
        self.assertEqual(self.rows('phone_observations')[0]['reason'],'invalid_or_conflicting_extension')

    def test_empty_extension_id_recipe_and_existing_rows_not_rekeyed(self):
        self.ingest(phone='5195550123')
        row=self.rows('contact_channels')[0]
        self.assertEqual(row['id'],stable_id('channel',row['organisation_id'],row['location_id'],'phone',row['value'],row['evidence_id']))
        before=dict(row)
        self.ingest(phone='5195550123 x09')
        self.assertEqual(dict(self.store.db.execute('SELECT * FROM contact_channels WHERE id=?',(row['id'],)).fetchone()),before)

    def test_reporting_exposes_extension_and_legacy_schema_fallback(self):
        self.ingest(phone='5195550123 x09')
        rows=list(_accounts(self.store))
        self.assertEqual(rows[0]['phone_channel_details'][0]['extension'],'09')
        self.store.db.execute('DROP TABLE phone_channel_details')
        self.assertTrue(list(_accounts(self.store)))

    def test_additive_schema_upgrade_on_temporary_legacy_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'legacy.sqlite'
            old=MarketMap(path)
            sid=old.upsert_source(self.source)
            old.ingest(sid,[{'name':'Legacy','source_record_id':'one','phone':'5195550123'}])
            before=[tuple(r) for r in old.db.execute('SELECT * FROM contact_channels')]
            old.db.execute('DROP TABLE phone_observations');old.db.execute('DROP TABLE phone_channel_details')
            old.db.execute("DELETE FROM schema_migrations WHERE version='008_phone_channel_details.sql'")
            old.db.commit();old.close()
            candidate=MarketMap(path)
            self.assertEqual([tuple(r) for r in candidate.db.execute('SELECT * FROM contact_channels')],before)
            self.assertEqual(candidate.db.execute('SELECT count(*) FROM phone_channel_details').fetchone()[0],0)
            candidate.close()

    def test_export_screener_uses_shared_international_contract(self):
        from scripts.market_map.verification_pilot import check_contact
        self.assertEqual(check_contact('phone','+4422345678')['normalised_candidate'],'+4422345678')
        self.assertIsNone(check_contact('phone','+11234567890')['normalised_candidate'])
