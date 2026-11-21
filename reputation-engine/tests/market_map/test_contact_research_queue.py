import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.contact_research_queue import connect,seed,ingest,export,validate_evidence


class ContactResearchQueueTests(unittest.TestCase):
    def fixtures(self,root):
        context=root/'context.sqlite';email=root/'emails.sqlite'
        c=sqlite3.connect(context);c.executescript('CREATE TABLE jobs(domain TEXT,status TEXT);CREATE TABLE context_claims(id TEXT,domain TEXT,claim_type TEXT,source_url TEXT,payload TEXT);')
        c.executemany('INSERT INTO jobs VALUES(?,?)',[('a.test','pending'),('b.test','pending'),('held.test','upstream_review_hold')])
        for key,domain,typ,payload in [('one','a.test','people',{'name':'Jane Smith','role_title':'Director','source_listing_kind':'board_or_advisory_listing'}),('two','b.test','department_contacts',{'email':'info@b.test'}),('three','held.test','people',{'name':'Held Person','role_title':'CEO'})]:
            c.execute('INSERT INTO context_claims VALUES(?,?,?,?,?)',(key,domain,typ,'https://'+domain+'/team',json.dumps(payload)))
        c.commit();c.close()
        c=sqlite3.connect(email);c.execute('CREATE TABLE associations(organisation_id TEXT,domain TEXT,name TEXT,url TEXT)');c.execute('INSERT INTO associations VALUES(?,?,?,?)',('org1','a.test','A Company','https://a.test'));c.commit();c.close()
        return context,email

    @patch('scripts.market_map.contact_research_queue.storage_guard')
    def test_resumable_seed_dedupes_and_does_not_modify_sources(self,guard):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);context,email=self.fixtures(root);before=(context.read_bytes(),email.read_bytes());db=connect(root/'output.sqlite')
            self.assertEqual(seed(db,context,email,1)['new_tasks'],3)
            self.assertEqual(seed(db,context,email,1)['new_tasks'],3)
            self.assertEqual(seed(db,context,email,1)['new_tasks'],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM research_tasks').fetchone()[0],6)
            self.assertEqual(before,(context.read_bytes(),email.read_bytes()))
            a=json.loads(db.execute("SELECT payload FROM research_tasks WHERE subject_domain='a.test' LIMIT 1").fetchone()[0]);self.assertEqual(a['employer_identity_status'],'not_established');self.assertEqual(a['source_listing_kind'],'board_or_advisory_listing')
            self.assertTrue(all(row[0] is None for row in db.execute("SELECT person_name FROM research_tasks WHERE subject_domain='b.test'")))
            db.close()

    @patch('scripts.market_map.contact_research_queue.storage_guard')
    def test_late_claim_is_not_lost_after_domain_processed(self,guard):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);context,email=self.fixtures(root);db=connect(root/'output.sqlite');seed(db,context,email)
            c=sqlite3.connect(context);c.execute('INSERT INTO context_claims VALUES(?,?,?,?,?)',('new','a.test','people','https://a.test/team',json.dumps({'name':'New Person','role_title':'CEO'})));c.commit();c.close()
            self.assertEqual(seed(db,context,email)['new_tasks'],3)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM research_tasks').fetchone()[0],9);db.close()

    def evidence(self,**overrides):
        return {**{'source_url':'https://association.test/bio','retrieved_at':'2026-10-27T12:00:00Z','source_family':'association','subject_domain':'a.test','person_name':'Jane Smith','claim_type':'employment_role','excerpt':'Published role statement','status':'source_claim'},**overrides}

    @patch('scripts.market_map.contact_research_queue.storage_guard')
    def test_sources_and_snippets_preserved_without_verification(self,guard):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);db=connect(root/'out.sqlite');p=root/'rows.jsonl'
            rows=[self.evidence(),self.evidence(source_url='https://conference.test/speaker'),self.evidence(status='snippet_only')]
            p.write_text('\n'.join(json.dumps(r) for r in rows));self.assertEqual(ingest(db,p)['new_evidence_rows'],3);self.assertEqual(ingest(db,p)['new_evidence_rows'],0)
            snippet=json.loads(db.execute("SELECT payload FROM evidence WHERE status='snippet_only'").fetchone()[0]);self.assertEqual(snippet['review_status'],'snippet_discovery_only');self.assertFalse(snippet['employment_verified'])
            self.assertEqual(export(db,root/'export')['external_evidence_rows'],3);db.close()

    @patch('scripts.market_map.contact_research_queue.storage_guard')
    def test_invalid_batch_is_atomic(self,guard):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);db=connect(root/'out.sqlite');p=root/'rows.jsonl';p.write_text(json.dumps(self.evidence())+'\n'+json.dumps(self.evidence(status='verified')))
            with self.assertRaises(ValueError):ingest(db,p)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM evidence').fetchone()[0],0);db.close()

    def test_evidence_needs_named_subject_and_timezone(self):
        with self.assertRaises(ValueError):validate_evidence(self.evidence(person_name=None))
        with self.assertRaises(ValueError):validate_evidence(self.evidence(retrieved_at='2026-10-27'))
        self.assertFalse(validate_evidence(self.evidence(organisation_name='A Company',person_name=None))['identity_verified'])


if __name__=='__main__':unittest.main()
