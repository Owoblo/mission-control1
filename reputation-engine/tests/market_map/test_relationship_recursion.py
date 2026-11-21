import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from scripts.market_map.relationship_queue import initialise as initialise_queue,select_candidates
from scripts.market_map.relationship_recursion import initialise,add_claim,export_handoff,ingest_saved_explicit


class RelationshipRecursionTests(unittest.TestCase):
    def test_reviewed_grid_checks_exact_image_link_and_replay(self):
        with tempfile.TemporaryDirectory() as folder:
            base=Path(folder);db=self.setup_db(folder);body=b'<html><body><p>Our partners.</p><a href="https://target.ca/"><img src="logo.png" alt=""></a></body></html>'
            artifact=base/'source.html';artifact.write_bytes(body)
            row=dict(source_id='grid',source_record_id='slot1',source_url='https://source.ca/partners',source_artifact=str(artifact),source_artifact_sha256=hashlib.sha256(body).hexdigest(),source_statement='Our partners.',subject_name='Source',object_name_published='Target',object_website='https://target.ca/',predicate='listed_partner_of',direction='source_to_target',observed_at='time',source_role='partner_grid',source_element_ordinal=1,source_element_xpath='/html/body/a/img',published_anchor_href='https://target.ca/',published_img_src='logo.png',published_img_alt='')
            path=base/'claims.jsonl';path.write_text(json.dumps(row))
            self.assertEqual(ingest_saved_explicit(db,path)['new_edges'],1)
            self.assertEqual(ingest_saved_explicit(db,path)['new_edges'],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM reviewed_grid_members').fetchone()[0],1)
            path.write_text(json.dumps(dict(row,published_img_src='different.png')))
            with self.assertRaisesRegex(ValueError,'attributes differ'):ingest_saved_explicit(db,path)
            db.close()

    def claim(self,edge='edge1',**values):
        return {'observation_id':edge,'publisher_domain':'source.ca','source_page_url':'https://source.ca/partners',
            'source_page_title':'Our Partners | Source Company','source_organisation_id':'source-org','source_company_label':'Source Company',
            'source_identity_status':'heading_self_identification_evidence','target_company_or_association_label':'Target Company',
            'target_website':'https://target.ca/','claimed_predicate':'listed_partner_of','direction':'source_to_target','logo_only':False,
            'short_context':'Our Partners','page_content_sha256':'bodyhash','observed_at':'2026-10-27',**values}
    def state(self,**values):return {'status':'bounded_discovery_pages_observed','pages':[],'organisations':[],**values}
    def setup_db(self,folder):
        db=initialise_queue(Path(folder)/'queue.sqlite');initialise(db);return db

    def test_parallel_edges_replay_and_domain_dedupe_without_company_merge(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.setup_db(folder)
            with db:
                one=add_claim(db,self.claim(),self.state(),source_receipt='fixture')
                replay=add_claim(db,self.claim(),self.state(),source_receipt='fixture')
                two=add_claim(db,self.claim('edge2',source_page_url='https://source.ca/clients'),self.state(),source_receipt='fixture2')
            self.assertEqual((one['new_edges'],replay['new_edges'],two['new_edges']),(1,0,1))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recursive_edge_evidence').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM research_candidates').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],1)
            self.assertTrue(db.execute('SELECT organisation_id FROM associations').fetchone()[0].startswith('relationship-candidate:'))
            db.close()

    def test_recursive_depth_parent_and_cycle_do_not_reset_observed_domain(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.setup_db(folder)
            with db:
                add_claim(db,self.claim(),self.state(),source_receipt='fixture')
                parent=db.execute('SELECT candidate_id FROM research_candidates').fetchone()[0]
                origin={'candidate_id':parent,'root_domain':'source.ca','discovery_depth':1}
                add_claim(db,self.claim('edge2',publisher_domain='target.ca',source_page_url='https://target.ca/partners',target_website='https://third.ca/',target_company_or_association_label='Third Company'),self.state(research_origin=origin),source_receipt='fixture2')
                add_claim(db,self.claim('edge3',publisher_domain='third.ca',source_page_url='https://third.ca/partners'),self.state(research_origin={'candidate_id':'third','root_domain':'source.ca','discovery_depth':2}),source_receipt='fixture3')
            row=db.execute('SELECT parent_candidate_id,discovery_depth,root_domain FROM recursive_edge_evidence WHERE edge_id=\'edge2\'').fetchone()
            self.assertEqual(tuple(row),(parent,2,'source.ca'))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs WHERE domain=\'target.ca\'').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM recursive_edge_evidence').fetchone()[0],3);db.close()

    def test_unresolved_names_and_nonofficial_links_remain_pending_without_crawl(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.setup_db(folder)
            with db:
                add_claim(db,self.claim(target_website=None),self.state(),source_receipt='fixture')
                add_claim(db,self.claim('edge2',target_website='https://facebook.com/target'),self.state(),source_receipt='fixture2')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM research_candidates').fetchone()[0],2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)
            report=export_handoff(db,folder);rows=[json.loads(line) for line in Path(report['handoff_file']).read_text().splitlines()]
            self.assertTrue(all(r['resolution_status']!='direct_link_candidate' for r in rows));db.close()

    def test_supplier_direction_logo_uncertainty_and_geography_retained(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.setup_db(folder)
            with db:add_claim(db,self.claim(claimed_predicate='claimed_supplier_of',direction='target_to_source',logo_only=True),self.state(),source_receipt='fixture')
            payload=json.loads(db.execute('SELECT payload_json FROM recursive_edge_evidence').fetchone()[0])
            self.assertEqual(payload['direction'],'target_to_source');self.assertTrue(payload['logo_only'])
            self.assertFalse(payload['relationship_verified']);self.assertFalse(payload['official_website_identity_verified'])
            self.assertEqual(payload['geography_status'],'unknown_external_research_candidate');db.close()

    def test_recursive_lane_reserves16_and_original_lane48_with_email_leases_excluded(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.setup_db(folder)
            with db:
                for i in range(80):
                    name='recursive'+str(i)+'.ca';db.execute('INSERT INTO jobs(domain,id,url,priority) VALUES(?,?,?,?)',(name,name,'https://'+name+'/','zz'+name))
                    db.execute('INSERT INTO research_domains VALUES(?,?,?,?,?,?)',(name,name,'root.ca',1,name,'time'))
                    db.execute('INSERT INTO research_candidates(candidate_id,name,domain,resolution_status) VALUES(?,?,?,?)',(name,name,name,'direct_link_candidate'))
                    name='original'+str(i)+'.ca';db.execute('INSERT INTO jobs(domain,id,url,priority) VALUES(?,?,?,?)',(name,name,'https://'+name+'/','aa'+name))
            selected=select_candidates(db,64,running={'recursive79.ca','original79.ca'})
            self.assertEqual(sum(row['domain'].startswith('recursive') for row in selected),16)
            self.assertEqual(sum(row['domain'].startswith('original') for row in selected),48)
            self.assertFalse({'recursive79.ca','original79.ca'}&{row['domain'] for row in selected});db.close()

    def test_forms_review_provider_and_CTA_never_seed_company_recursion(self):
        with tempfile.TemporaryDirectory() as folder:
            db=self.setup_db(folder)
            for i,(label,url) in enumerate([('GET YOUR PROJECT STARTED','https://5nogtc.share-na3.hsforms.com/x'),('Submit a maintenance request','https://form.jotform.com/123'),('NPS Today','https://review.nps.today/x')]):
                with db:result=add_claim(db,self.claim('utility'+str(i),target_company_or_association_label=label,target_website=url),self.state(),source_receipt='fixture')
                self.assertEqual(result['status'],'nonofficial_social_media_or_utility_review')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0);db.close()


if __name__=='__main__':unittest.main()
