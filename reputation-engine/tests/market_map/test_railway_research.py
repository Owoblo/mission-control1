import base64
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest
from scripts.market_map.cloud.railway_entry import authenticated,restore_seed


class RailwayResearchTests(unittest.TestCase):
    def test_dashboard_requires_exact_credentials(self):
        token='Basic '+base64.b64encode(b'john:test-password').decode()
        self.assertTrue(authenticated(token,'test-password'))
        self.assertFalse(authenticated(token,''))
        self.assertFalse(authenticated(token,'different'))
        self.assertFalse(authenticated('Basic !!!','test-password'))

    def archive(self,root,unsafe=False,bad_hash=False):
        db=root/'source.sqlite3';c=sqlite3.connect(db)
        c.execute('CREATE TABLE research_results(site_id)');c.execute("INSERT INTO research_results VALUES('site:a')");c.commit();c.close()
        name='../escape' if unsafe else 'artifacts/windsor-source-first-20261030/sites.sqlite3'
        body=db.read_bytes();manifest={'files':{name:'0'*64 if bad_hash else hashlib.sha256(body).hexdigest()}}
        path=root/'seed.tar.gz'
        with tarfile.open(path,'w:gz') as out:
            for filename,data in [(name,body),('transfer-manifest.json',json.dumps(manifest).encode())]:
                info=tarfile.TarInfo(filename);info.size=len(data);out.addfile(info,io.BytesIO(data))
        return path

    def test_restore_hashes_database_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);archive=self.archive(root)
            result=restore_seed(archive,root/'restored');self.assertEqual(result['saved_investigations'],1)
            with self.assertRaisesRegex(ValueError,'overwritten'):restore_seed(archive,root/'restored')

    def test_rejects_traversal_and_corrupt_seed(self):
        for kwargs in ({'unsafe':True},{'bad_hash':True}):
            with tempfile.TemporaryDirectory() as directory:
                root=Path(directory);archive=self.archive(root,**kwargs)
                with self.assertRaises(ValueError):restore_seed(archive,root/'restored')
                self.assertFalse((root/'restored').exists())


if __name__=='__main__':unittest.main()
