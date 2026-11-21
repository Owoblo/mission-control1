import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from scripts.market_map.relationship_observations import parse_claim_page,claim_observations,observe_domain,WaveBudget,StorageHold,guard
from scripts.market_map.transport import Response


class FixtureTransport:
    def __init__(self,pages):self.pages=pages;self.urls=[];self.bytes_fetched=0
    def fetch(self,url,**kwargs):
        self.urls.append(url);body=self.pages[url].encode();self.bytes_fetched+=len(body)
        return Response(body,{'Content-Type':'text/html'},url)
    def metrics(self):return {'requests':len(self.urls),'bytes_fetched':self.bytes_fetched}


class RelationshipObservationTests(unittest.TestCase):
    def test_news_and_about_routes_are_discovered_without_assuming_relationships(self):
        page=parse_claim_page(b'<title>News</title><a href="/newsroom">Press releases</a><a href="/about-us">About us</a><a href="https://unrelated.ca">Unrelated Company</a>','https://fixture.ca/')
        self.assertEqual(set(page['discovery_links']),{'https://fixture.ca/newsroom','https://fixture.ca/about-us'})
        self.assertFalse(any(r['url']=='https://unrelated.ca' for r in page['assertions']))

    def test_policy_is_inspected_without_recursive_locale_routing(self):
        page=parse_claim_page(b'<title>Privacy</title><p>For personal use only.</p><a href="/fr/privacy">Privacy</a><a href="/news">News</a><a href="/partners">Partners</a>','https://fixture.ca/privacy')
        self.assertTrue(page['restriction_excerpts'])
        self.assertEqual(page['policy_links'],[])
        self.assertEqual(page['discovery_links'],[])
        self.assertEqual(page['links'],[])

    def test_blank_alt_anchor_title_is_captured_and_unknown_images_are_audited(self):
        body=b'<title>Our Partners | Fixture Industrial</title><main><a title="Named Partner" href="https://partner.ca"><img src="partner.png" alt=""></a><a href="https://unknown.ca"><img src="unknown.png" alt=""></a></main>'
        page=parse_claim_page(body,'https://fixture.ca/partners')
        self.assertIn('Named Partner',{r['name'] for r in page['assertions']})
        self.assertEqual(page['logo_inventory']['counts']['all_img_elements'],2)
        self.assertEqual(page['visual_review_status'],'visual_review_pending')
        self.assertTrue(page['unresolved_image_occurrence_ids'])

    def setUp(self):
        self.job={'job_id':'fixture','domain':'fixture.ca','candidate_urls':['https://fixture.ca/'],
            'organisations':[{'organisation_id':'org-source','name':'Fixture Industrial'}]}

    def test_customer_direction_is_a_claim_not_a_contract(self):
        page=parse_claim_page(b'<title>Our Clients | Fixture Industrial</title><main><a href="https://customer.ca">Customer Ltd</a></main>','https://fixture.ca/clients')
        rows=claim_observations(self.job,page,'https://fixture.ca/clients','hash','time',{'org-source'},'limited_factual')
        self.assertEqual(rows[0]['claimed_predicate'],'claimed_customer_of')
        self.assertEqual(rows[0]['subject_label'],'Customer Ltd');self.assertEqual(rows[0]['object_label'],'Fixture Industrial')
        self.assertFalse(rows[0]['contract_verified']);self.assertFalse(rows[0]['current_relationship_verified'])

    def test_linked_and_unlinked_logos_never_become_clients_or_owners(self):
        page=parse_claim_page(b'<title>Our Clients | Fixture Industrial</title><main><a href="https://apple.com"><img alt="Apple"></a><img class="client-logo" alt="Unlinked Manufacturing"></main>','https://fixture.ca/clients')
        self.assertEqual({row['name'] for row in page['assertions']},{'Apple','Unlinked Manufacturing'})
        self.assertTrue(all(row['predicate']=='unverified_association' for row in page['assertions']))
        self.assertIsNone(next(row for row in page['assertions'] if row['name']=='Unlinked Manufacturing')['url'])

    def test_homepage_client_section_supports_unlinked_logo_observation(self):
        page=parse_claim_page(b'<title>Fixture Industrial</title><section><h2>Our clients</h2><img class="client-logo" alt="Related Company"></section>','https://fixture.ca/')
        self.assertEqual(page['assertions'][0]['name'],'Related Company')

    def test_wrong_or_unknown_source_identity_not_attributed_to_account(self):
        page=parse_claim_page(b'<title>Our partners | Different Business</title><main><a href="https://other.ca">Other Company</a></main>','https://fixture.ca/partners')
        rows=claim_observations(self.job,page,'https://fixture.ca/partners','hash','time',set(),'limited_factual')
        self.assertIsNone(rows[0]['source_organisation_id']);self.assertEqual(rows[0]['source_identity_status'],'unresolved_source_identity')

    def test_manual_hold_makes_no_network_requests(self):
        with tempfile.TemporaryDirectory() as folder,patch('scripts.market_map.relationship_observations.guard'):
            output=Path(folder);(output/'domains').mkdir();transport=FixtureTransport({})
            result=observe_domain(self.job,output,{'reviews':{'fixture.ca':{'reuse_status':'hold_pending_permission'}}},WaveBudget(),transport_factory=lambda:transport)
            self.assertEqual(result['status'],'manual_review_hold');self.assertEqual(transport.urls,[])

    def test_wave_limit_retains_frontier_and_resume_does_not_refetch_root(self):
        pages={'https://fixture.ca/':'<title>Fixture Industrial</title><a href="/clients">Our Clients</a><a href="/partners">Our Partners</a>',
               'https://fixture.ca/clients':'<title>Our Clients | Fixture Industrial</title><a href="https://client.ca">Client Company</a>',
               'https://fixture.ca/partners':'<title>Our Partners | Fixture Industrial</title><a href="https://partner.ca">Partner Company</a>'}
        with tempfile.TemporaryDirectory() as folder,patch('scripts.market_map.relationship_observations.guard'):
            output=Path(folder);(output/'domains').mkdir();one=FixtureTransport(pages)
            result=observe_domain(self.job,output,{},WaveBudget(),max_pages=1,transport_factory=lambda:one)
            self.assertEqual(len(result['pages']),1);self.assertEqual(sum(p['status']=='pending' for p in result['frontier']),2)
            two=FixtureTransport(pages);result=observe_domain(self.job,output,{},WaveBudget(),max_pages=3,transport_factory=lambda:two)
            self.assertNotIn('https://fixture.ca/',two.urls);self.assertEqual(len(result['claims']),2)
            self.assertFalse(result['full_site_exhausted'])

    def test_supplier_direction_and_legal_restriction_are_preserved(self):
        page=parse_claim_page(b'<title>Our Suppliers | Fixture Industrial</title><a href="https://supplier.ca">Supplier Ltd</a><p>For personal use only.</p>','https://fixture.ca/suppliers')
        self.assertEqual(page['assertions'][0]['predicate'],'claimed_supplier_of');self.assertEqual(page['assertions'][0]['direction'],'target_to_source')
        self.assertTrue(page['restriction_excerpts'])

    def test_low_storage_blocks_before_network_or_output(self):
        with patch('scripts.market_map.relationship_observations.shutil.disk_usage') as disk:
            disk.return_value.free=2147483647
            with self.assertRaises(StorageHold):guard(Path('.'))

    def test_dealer_product_images_and_generic_actions_are_not_company_associations(self):
        page=parse_claim_page(b'<title>Fixture Industrial Dealer</title><section><h2>Dealer Support</h2><img alt="Condenser"><a href="https://finance.ca">Apply Now</a></section>','https://fixture.ca/')
        self.assertEqual(page['assertions'],[])

    def test_shared_brand_domain_does_not_copy_relationship_to_every_branch_account(self):
        job={**self.job,'organisations':[{'organisation_id':'branch1','name':'Fixture Industrial'},{'organisation_id':'branch2','name':'Fixture Industrial'}]}
        page=parse_claim_page(b'<title>Our Clients | Fixture Industrial</title><a href="https://client.ca">Client Company</a>','https://fixture.ca/clients')
        rows=claim_observations(job,page,'https://fixture.ca/clients','hash','time',{'branch1','branch2'},'limited_factual')
        self.assertEqual(len(rows),1);self.assertIsNone(rows[0]['source_organisation_id'])
        self.assertEqual(rows[0]['source_account_attribution_scope'],'publisher_domain_only_shared_accounts')


if __name__=='__main__':unittest.main()
