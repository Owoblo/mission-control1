import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.site_source_index import SiteSourceIndex


class SourceIndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.cache=self.root/'.runtime/trusted-source-cache/objects';self.cache.mkdir(parents=True)
    def tearDown(self):self.tmp.cleanup()

    def save(self, body, url='https://example.org/shops', **overrides):
        body=body.encode();digest=hashlib.sha256(body).hexdigest()
        path=self.cache/(digest+'.body');path.write_bytes(body)
        receipt=dict(requested_url=url,final_url=url,status=200,retrieved_at='2026-10-30T00:00:00Z',
            body_sha256=digest,body_path=str(path.relative_to(self.root)),content_type='text/html',
            cache_control='public')
        receipt.update(overrides)
        raw=json.dumps(receipt).encode()
        (self.cache/(hashlib.sha256(raw).hexdigest()+'.receipt.json')).write_bytes(raw)
        return path

    def site(self,address='42 Main St',names=()):
        return dict(addresses=[address],municipality='Windsor',reported_place_names=list(names))

    def test_structured_address_aliases_and_locality(self):
        self.save('<script type="application/ld+json">'+json.dumps({'@type':'LocalBusiness','name':'A',
            'address':{'streetAddress':'42 Main Street East','addressLocality':'Windsor'}})+'</script>')
        index=SiteSourceIndex(self.root)
        self.assertEqual(index.lookup(self.site('42 Main St E')),['https://example.org/shops'])
        self.assertEqual(index.lookup(self.site('42 Main St W')),[])
        self.assertEqual(index.lookup(dict(addresses=['42 Main St E'],municipality='Toronto')),[])

    def test_plain_text_requires_name_address_and_city(self):
        self.save('<p>Example Store, 42 Main Street, Windsor</p>')
        index=SiteSourceIndex(self.root)
        self.assertEqual(index.lookup(self.site()),[])
        self.assertEqual(index.lookup(self.site(names=['Example Store'])),['https://example.org/shops'])
        self.assertEqual(index.lookup(self.site(names=['Other Store'])),[])
        self.assertEqual(index.lookup(self.site('142 Main St', ['Example Store'])),[])

    def test_units_directions_and_ranges_not_collapsed(self):
        for address in ('42 Main Street Suite 2','42 Main Street East','42-44 Main Street'):
            self.save('<p>Example Store '+address+' Windsor</p>',url='https://example.org/'+str(len(address)))
        index=SiteSourceIndex(self.root)
        self.assertEqual(index.lookup(self.site(names=['Example Store'])),[])
        self.assertTrue(index.lookup(self.site('42 Main St Suite 2',['Example Store'])))

    def test_hash_mismatch_and_path_escape_are_excluded(self):
        path=self.save('Example Store 42 Main Street Windsor');path.write_bytes(b'changed')
        self.save('x',url='https://example.org/escape',body_path='../outside')
        index=SiteSourceIndex(self.root)
        self.assertEqual(index.lookup(self.site(names=['Example Store'])),[])
        self.assertEqual(index.stats['excluded_invalid_capture'],2)

    def test_robots_not_source_and_parse_only_once(self):
        self.save('Example Store 42 Main Street Windsor',url='https://example.org/robots.txt')
        self.save('Example Store 42 Main Street Windsor')
        index=SiteSourceIndex(self.root)
        for p in self.cache.glob('*.body'):p.unlink()
        self.assertEqual(index.lookup(self.site(names=['Example Store'])),['https://example.org/shops'])
        self.assertEqual(index.stats['sources_indexed'],1)

    def test_bounded_results(self):
        for i in range(7):self.save('Example Store 42 Main Street Windsor',url='https://example.org/'+str(i))
        index=SiteSourceIndex(self.root)
        self.assertEqual(len(index.lookup(self.site(names=['Example Store']))),4)
        with self.assertRaises(ValueError):index.lookup(self.site(),limit=5)


if __name__=='__main__':unittest.main()
