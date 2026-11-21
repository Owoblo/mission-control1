import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.toronto_bulk_sources import parse_csv,collect_one
from scripts.market_map.transport import SourceBlocked,Response

class FakeTransport:
    def __init__(self,*args,**kwargs):self.requests=0
    def fetch(self,url):
        self.requests+=1
        if '/api/3/' in url:
            return Response(json.dumps({'success':True,'result':{'resources':[{'id':'fixture-resource','format':'CSV','url':'https://official.test/source.csv','size':len(b'_id,establishment_id,name\n1,33,Fixture\n2,33,Other\n'),'record_count':2}]}}).encode(),{},url)
        if url.endswith('.csv'):return Response(b'_id,establishment_id,name\n1,33,Fixture\n2,33,Other\n',{},url)
        return Response(b'open-data-licence commercial royalty-free attribution',{},url)
    def metrics(self):return {'requests':self.requests,'bytes_fetched':0,'paid_service_calls':0}

class TorontoBulkTests(unittest.TestCase):
    def test_repeated_establishment_not_repeated_inspection(self):
        p=parse_csv(b'_id,establishment_id,name\n1,33,One\n2,33,Two\n')
        self.assertEqual(p['raw_rows'],2);self.assertEqual(p['native_object_ids'],2)
    def test_duplicate_object_ids_not_full_proof(self):
        with self.assertRaises(SourceBlocked):parse_csv(b'_id,name\n1,One\n1,Two\n')
    def test_empty_malformed_and_html_are_not_complete(self):
        for body in [b'_id,name\n',b'<html>error</html>',b'_id,name\n1,Two,extra\n']:
            with self.assertRaises(SourceBlocked):parse_csv(body)
    def test_full_fixture_preserves_inspection_scope(self):
        with tempfile.TemporaryDirectory() as tmp,patch('scripts.market_map.toronto_bulk_sources.Transport',FakeTransport):
            m=collect_one('dinesafe',Path(tmp))
            self.assertEqual(m['status'],'acquired_complete');self.assertEqual(m['raw_rows'],2)
            self.assertIsNone(m['company_count']);self.assertFalse(m['current_business_operation_verified'])
            replay=collect_one('dinesafe',Path(tmp));self.assertEqual(replay,m)
