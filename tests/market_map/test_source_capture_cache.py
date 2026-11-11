import json
import multiprocessing
import tempfile
import time
import unittest
from pathlib import Path
from scripts.market_map.source_capture_cache import cached_capture

URL='https://public.test/source'

def process_capture(root):
    def fetcher():
        with (Path(root)/'fetches.txt').open('a') as f:f.write('fetch\n')
        time.sleep(.1)
        return b'raw primary source',{'requested_url':URL,'status':200}
    cached_capture(URL,root,fetcher)

class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.calls=0
    def fetch(self):
        self.calls+=1
        return b'raw primary source',{'requested_url':URL,'status':200}
    def test_hits_and_content_addressed_objects(self):
        first=cached_capture(URL,self.root,self.fetch,now=10)
        second=cached_capture(URL,self.root,self.fetch,now=20)
        self.assertFalse(first['cache_hit']);self.assertTrue(second['cache_hit']);self.assertEqual(self.calls,1)
        self.assertIn(first['body_sha256'],first['body_path'])
        self.assertEqual(first['body_path'],second['body_path'])
    def test_expiry_and_clock_reversal_refetch(self):
        cached_capture(URL,self.root,self.fetch,now=100,freshness_seconds=10)
        cached_capture(URL,self.root,self.fetch,now=110,freshness_seconds=10)
        cached_capture(URL,self.root,self.fetch,now=90,freshness_seconds=10)
        self.assertEqual(self.calls,3)
    def test_body_tamper_refetch_not_trusted(self):
        first=cached_capture(URL,self.root,self.fetch,now=10)
        (self.root/first['body_path']).write_text('authored summary')
        result=cached_capture(URL,self.root,self.fetch,now=11)
        self.assertFalse(result['cache_hit']);self.assertEqual(self.calls,2)
        self.assertEqual((self.root/result['body_path']).read_bytes(),b'raw primary source')
    def test_receipt_index_tamper_rejected(self):
        cached_capture(URL,self.root,self.fetch,now=10)
        index=next((self.root/'.runtime/trusted-source-cache').glob('*.json'))
        data=json.loads(index.read_text());data['payload']['receipt']['requested_url']='https://forged.test'
        index.write_text(json.dumps(data))
        result=cached_capture(URL,self.root,self.fetch,now=11)
        self.assertFalse(result['cache_hit']);self.assertEqual(result['requested_url'],URL)
    def test_no_store_and_max_age(self):
        def fetcher():
            self.calls+=1
            return b'raw',{'requested_url':URL,'status':200,'cache_control':'no-store'}
        for now in (10,11):
            with self.assertRaises(ValueError):cached_capture(URL,self.root,fetcher,now=now)
        self.assertEqual(self.calls,2)
        self.assertFalse((self.root/'.runtime/trusted-source-cache/objects').exists())
    def test_processes_fetch_same_url_once(self):
        if globals().get('OFFLINE_GUARD'):
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(process_capture,[str(self.root)]*3))
            self.assertEqual((self.root/'fetches.txt').read_text().splitlines(),['fetch'])
            return
        context=multiprocessing.get_context('fork')
        workers=[context.Process(target=process_capture,args=(str(self.root),)) for _ in range(3)]
        for worker in workers:worker.start()
        for worker in workers:worker.join(5);self.assertEqual(worker.exitcode,0)
        self.assertEqual((self.root/'fetches.txt').read_text().splitlines(),['fetch'])

if __name__=='__main__':unittest.main()
