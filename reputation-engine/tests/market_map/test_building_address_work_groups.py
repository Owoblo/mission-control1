import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from scripts.market_map.building_address_work_groups import build_manifest, generate


def row(bid, addresses, **kw):
    return {'building_id':bid,'candidate_addresses':addresses,'original_zoning_scope':True,**kw}


def items(rows):
    return [{'building_id':r['building_id'],'state':'pending','snapshot':json.dumps(r),'attempts':0,'available_at':0} for r in rows]


class AddressGroupsTests(unittest.TestCase):
    def test_exact_normalization_and_identity_preservation(self):
        rows=[row('a',[' 123 Main St ']),row('b',['123 MAIN ST']),row('c',['123 MAIN STREET']),row('d',['123 MAIN ST UNIT 2'])]
        m=build_manifest(rows,items(rows))
        self.assertEqual(m['summary']['groups'],3)
        self.assertEqual(m['summary']['potential_repeated_address_queries_avoided'],1)
        self.assertEqual(sorted(b for g in m['groups'] for b in g['building_ids']),['a','b','c','d'])
        self.assertFalse(any(g['identity_merge_permitted'] for g in m['groups']))

    def test_ambiguous_street_missing_and_ranges_not_safe(self):
        rows=[row('a',['1 MAIN ST','2 MAIN ST']),row('b',['2 MAIN ST','1 MAIN ST']),row('c',['MAIN ST']),row('d',[]),row('e',[]),row('f',['12-14 MAIN ST']),row('g',['UNIT 2 12 MAIN ST']),row('h',['9 MAIN ST'],address_matching_status='address_conflict')]
        m=build_manifest(rows,items(rows))
        self.assertEqual(m['summary']['groups'],7)
        self.assertFalse(any(g['reusable_address_query_candidate'] for g in m['groups']))
        self.assertEqual(m['summary']['buildings_by_category']['missing_address'],2)
        self.assertEqual(m['summary']['largest_ambiguous_groups'][0]['building_count'],2)

    def test_queue_states_prior_reviews_and_missing_ledger(self):
        rows=[row('a',['1 MAIN']),row('b',['2 MAIN']),row('c',['3 MAIN']),row('d',['4 MAIN'])]
        q=items(rows);q[0]['state']='claimed';q[1]['state']='submitted'
        rows[2]['review_stages']={'address':'unresolved'}
        m=build_manifest(rows[:3],q)
        self.assertEqual(m['summary']['pending_buildings'],2)
        self.assertEqual(m['excluded_building_ids_by_queue_state'],{'claimed':['a'],'submitted':['b']})
        self.assertEqual(m['summary']['buildings_by_category']['pending_but_previously_reviewed'],1)
        self.assertFalse(next(g for g in m['groups'] if g['building_ids']==['d'])['members'][0]['ledger_present'])

    def test_ledger_change_visible_and_invalid_input_rejected(self):
        r=row('a',['1 MAIN']);q=items([r]);r['candidate_addresses']=['2 MAIN']
        self.assertEqual(build_manifest([r],q)['queue_ledger_address_mismatch_ids'],['a'])
        with self.assertRaises(ValueError):build_manifest([r,r],q)
        with self.assertRaises(ValueError):build_manifest([r],q+q)
        q[0]['snapshot']=json.dumps(row('wrong',['2 MAIN']))
        with self.assertRaises(ValueError):build_manifest([r],q)

    def test_generate_does_not_mutate_queue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);ledger=root/'ledger.jsonl';dbpath=root/'queue.sqlite';out=root/'groups.json'
            r=row('a',['1 MAIN']);ledger.write_text(json.dumps(r)+'\n')
            db=sqlite3.connect(dbpath);db.execute('CREATE TABLE building_items(building_id,state,snapshot,attempts,available_at)');db.execute('INSERT INTO building_items VALUES(?,?,?,?,?)',('a','pending',json.dumps(r),2,99));db.commit();db.close()
            before=dbpath.read_bytes();summary=generate(ledger,dbpath,out)
            self.assertEqual(summary['pending_buildings'],1);self.assertEqual(before,dbpath.read_bytes())
            self.assertEqual(json.loads(out.read_text())['queue_mutations'],0)
            self.assertTrue((root/'groups-summary.json').exists())
            with self.assertRaises(ValueError):generate(ledger,dbpath,ledger)


if __name__=='__main__':unittest.main()
