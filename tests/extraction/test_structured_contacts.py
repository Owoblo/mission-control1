import json
import unittest
from scripts.market_map.structured_contacts import walk_contact_graph
from scripts.market_map.email_extraction import extract_published_emails
from scripts.market_map.phone_extraction import extract_published_phones
from scripts.market_map.contact_context import extract_contact_context

class StructuredTests(unittest.TestCase):
    def body(self,value):return '<script type="application/ld+json">'+json.dumps(value)+'</script>'
    def test_types_arrays_and_pointers(self):
        for kind in ['RealEstateAgent','Dentist','Hotel','https://schema.org/LocalBusiness']:
            value={'@type':kind,'name':'Office','email':['desk@business.test','sales@business.test'], 'telephone':['+15195550123'],'faxNumber':'+15195550124'}
            rows=extract_published_emails(self.body(value),'https://business.test')
            self.assertEqual(len(rows),2)
            self.assertEqual({r['occurrences'][0]['json_pointer'] for r in rows},{'/email/0','/email/1'})
            self.assertEqual({r['kind'] for r in extract_published_phones(self.body(value),'https://business.test')},{'phone','fax'})
    def test_references_shared_points_and_duplicate_ids(self):
        graph={'@graph':[{'@type':'Organization','@id':'#a','name':'A','contactPoint':{'@id':'#desk'}},
                         {'@type':'ContactPoint','@id':'#desk','email':'desk@business.test'}]}
        row=[r for r in walk_contact_graph(graph) if r['channel']=='email'][0]
        self.assertEqual(row['candidate_owners'][0]['name'],'A')
        self.assertEqual(row['ownership_status'],'explicit_document_edge_not_verified')
        graph['@graph'].append({'@type':'Organization','@id':'#b','name':'B','contactPoint':{'@id':'#desk'}})
        row=[r for r in walk_contact_graph(graph) if r['channel']=='email'][0]
        self.assertEqual(row['ownership_status'],'unresolved');self.assertEqual(len(row['candidate_owners']),2)
        graph['@graph'].append({'@type':'ContactPoint','@id':'#desk','email':'other@business.test'})
        self.assertTrue(all(r['ownership_status']=='unresolved' for r in walk_contact_graph(graph) if r['channel']=='email'))
    def test_cycles_malformed_types_and_no_remote_or_cross_script_resolution(self):
        value={'@graph':[{'@type':'Organization','@id':'#a','contactPoint':{'@id':'#b'},'email':'a@business.test'},
                         {'@type':'ContactPoint','@id':'#b','contactPoint':{'@id':'#a'},'email':'b@business.test'}]}
        self.assertTrue(all(r['ownership_status']=='unresolved' for r in walk_contact_graph(value)))
        self.assertEqual(walk_contact_graph({'@type':{'bad':'Organization'},'email':'a@business.test'}),[])
        standalone={'@context':'https://unfetched.test/context','@type':'ContactPoint','@id':'#desk','email':'desk@business.test'}
        rows=extract_published_emails(self.body({'@type':'Organization','contactPoint':{'@id':'#desk'}})+self.body(standalone),'https://business.test')
        self.assertEqual(rows[0]['occurrences'][0]['candidate_owner']['ownership_status'],'unresolved')
        self.assertEqual(walk_contact_graph(value,max_nodes=1),[])
    def test_person_employer_is_explicit_and_article_author_excluded(self):
        person={'@type':'Person','name':'Jane Smith','jobTitle':'Facilities Manager','email':'jane@business.test','worksFor':{'@id':'#org'}}
        graph={'@graph':[person,{'@type':'Organization','@id':'#org','name':'Office'}]}
        data=extract_contact_context(self.body(graph),'https://business.test')
        self.assertEqual(data['people'][0]['published_employer'],'Office')
        self.assertEqual(data['people'][0]['employment_relationship_status'],'not_established')
        self.assertEqual(extract_contact_context(self.body({'@type':'Article','author':person}),'https://business.test')['people'],[])
    def test_nested_untyped_point_and_bad_block_isolation(self):
        value={'@type':'Organization','name':'Office','contactPoint':{'email':['desk@business.test']}}
        self.assertEqual([r['value'] for r in walk_contact_graph(value)],['desk@business.test'])
        body='<script type="application/ld+json">not json</script>'+self.body(value)
        self.assertEqual(len(extract_published_emails(body,'https://business.test')),1)
    def test_legacy_untyped_phone_arrays_remain_unresolved(self):
        rows=extract_published_phones(self.body({'telephone':['+15195550123','+442079460123']}),'https://business.test')
        self.assertEqual(len(rows),2)
        self.assertTrue(all(r['structured_evidence']['ownership_status']=='unresolved' for r in rows))
    def test_scalar_array_budget_is_enforced(self):
        self.assertEqual(walk_contact_graph({'@type':'Organization','email':['a@business.test']*50},max_nodes=10),[])
