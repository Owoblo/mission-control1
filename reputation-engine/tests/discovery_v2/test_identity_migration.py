import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from engine import Engine, LegacyIdentitySchemaError
from migrate_identity import rebuild

LEGACY = '''CREATE TABLE runs(id TEXT PRIMARY KEY,source TEXT,family TEXT,scope TEXT,category TEXT,kind TEXT,captured_at TEXT,cost REAL,result TEXT);
CREATE TABLE entities(id TEXT PRIMARY KEY,name TEXT,domain TEXT,city TEXT,address TEXT);
CREATE TABLE observations(id TEXT PRIMARY KEY,run_id TEXT,entity_id TEXT,source_url TEXT,captured_at TEXT,payload TEXT);
CREATE TABLE claims(id TEXT PRIMARY KEY,entity_id TEXT,dimension TEXT,status TEXT,observation_id TEXT,reason TEXT);
CREATE TABLE tasks(id TEXT PRIMARY KEY,scope TEXT,category TEXT,family TEXT,status TEXT,priority REAL,reason TEXT,updated_at TEXT);
CREATE TABLE source_links(source_url TEXT PRIMARY KEY,entity_id TEXT);'''


class IdentityMigrationTests(unittest.TestCase):
    def fixture(self, path, same_key=False):
        with sqlite3.connect(path) as db:
            db.executescript(LEGACY)
            db.execute("INSERT INTO runs VALUES('run','publisher','directory','fixture','*','discovery','2026-01-01',0,'{}')")
            db.execute("INSERT INTO entities VALUES('collapsed','Alpha','','','')")
            if same_key: db.execute("INSERT INTO entities VALUES('other','Beta','','','')")
            for i,name in enumerate(['Alpha','Beta','Unknown']):
                row={'name':name,'source_url':'https://directory.test/list'}
                if i<2: row['source_record_id']='a' if same_key else str(i)
                db.execute('INSERT INTO observations VALUES(?,?,?,?,?,?)',(str(i),'run','other' if same_key and i==1 else 'collapsed',row['source_url'],'2026-01-01',json.dumps(row)))
            db.execute("INSERT INTO tasks VALUES('task','fixture','*','directory','held',1,'manual hold','time')")
    def test_readonly_new_file_preserves_raw_tasks_and_collision_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'old.sqlite';target=Path(directory)/'new.sqlite';self.fixture(source)
            before=hashlib.sha256(source.read_bytes()).hexdigest()
            with self.assertRaises(LegacyIdentitySchemaError): Engine(source)
            report=rebuild(source,target)
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
            self.assertEqual(report['historical_split_candidates'],['collapsed'])
            self.assertEqual(len(report['mapping']),3)
            self.assertEqual(sum(r['new_entity_id'] is None for r in report['mapping']),1)
            with sqlite3.connect(target) as db:
                self.assertEqual(db.execute('SELECT status FROM tasks').fetchone()[0],'held')
                self.assertEqual(db.execute("SELECT count(*) FROM legacy_archive WHERE table_name='observations'").fetchone()[0],3)
            with self.assertRaises(LegacyIdentitySchemaError): Engine(target)
            with self.assertRaises(ValueError): rebuild(source,target)
            with self.assertRaises(ValueError): rebuild(source,source)
    def test_historical_many_to_one_keys_are_quarantined_not_merged(self):
        with tempfile.TemporaryDirectory() as directory:
            source=Path(directory)/'old.sqlite';target=Path(directory)/'new.sqlite';self.fixture(source,same_key=True)
            report=rebuild(source,target)
            self.assertTrue(all(r['new_entity_id'] is None for r in report['mapping']))
            self.assertEqual(report['automatic_merges'],0)
