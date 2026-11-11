import json
import unittest
from scripts.market_map.contact_context import extract_contact_context, explicit_company_description

URL='https://business.test/team'
class ContactContextTests(unittest.TestCase):
 def test_named_staff_card_preserves_role_and_email(self):
  result=extract_contact_context('<main><div class="team-card"><h3>Jane Smith</h3><p>Facilities Manager</p><a href="mailto:jane@business.test">Email</a></div></main>',URL)
  p=result['people'][0];self.assertEqual((p['name'],p['role_function'],p['emails']),('Jane Smith','facilities',['jane@business.test']))
  self.assertFalse(p['purchasing_authority_verified']);self.assertEqual(p['authority_scope'],'not_established');self.assertIn('page_content_sha256',p)
 def test_generic_inbox_is_not_personal_and_inc_not_size(self):
  result=extract_contact_context('<main><p>Example Inc.</p><div class="staff"><h3>Jane Smith</h3><p>CEO</p><a href="mailto:info@business.test">Email</a></div></main>',URL)
  self.assertEqual(result['people'][0]['emails'],[]);self.assertEqual(result['department_contacts'][0]['role_function'],'general_business');self.assertEqual(result['organisation_assertions'],[])
 def test_executive_role_inbox_is_not_named_person_email(self):
  result=extract_contact_context('<div class="team"><h3>Jane Smith</h3><p>CEO</p><a href="mailto:ceo@business.test">Email</a></div>',URL)
  self.assertEqual(result['people'][0]['emails'],[]);self.assertEqual(result['department_contacts'][0]['role_function'],'owner_executive')
 def test_multiple_staff_do_not_cross_assign_emails(self):
  result=extract_contact_context('<div class="team"><h3>Jane Smith</h3><h3>John Jones</h3><p>Operations Manager</p><a href="mailto:jane@business.test">Email</a></div>',URL)
  self.assertEqual(result['people'],[])
 def test_multiple_personal_emails_stay_unassigned(self):
  result=extract_contact_context('<div class="team"><h3>Jane Smith</h3><p>Office Manager</p><p>jane@business.test other@business.test</p></div>',URL)
  self.assertEqual(result['people'][0]['emails'],[])
 def test_testimonial_and_vacancy_not_staff(self):
  for klass in ['testimonial','job-posting']:
   result=extract_contact_context('<div class="'+klass+'"><h3>Jane Smith</h3><p>Operations Manager</p></div>',URL)
   self.assertEqual(result['people'],[])
 def test_structured_person_and_job_posting_exclusion(self):
  person={'@type':'Person','name':'Jane Smith','jobTitle':'Procurement Director','worksFor':{'name':'Example'},'email':'jane@business.test'}
  result=extract_contact_context('<script type="application/ld+json">'+json.dumps(person)+'</script>',URL)
  self.assertEqual(result['people'][0]['role_function'],'procurement')
  result=extract_contact_context('<script type="application/ld+json">'+json.dumps({'@type':'JobPosting','author':person})+'</script>',URL)
  self.assertEqual(result['people'],[])
 def test_named_email_alone_does_not_create_person(self):
  result=extract_contact_context('<p>john.smith@business.test</p>',URL);self.assertEqual(result['people'],[])
 def test_self_description_and_relevant_links(self):
  result=extract_contact_context('<main><p>We are a registered charity.</p><a href="/contact">Contact</a><a href="https://other.test/team">Team</a></main>',URL)
  self.assertEqual(result['organisation_assertions'][0]['category'],'nonprofit');self.assertEqual(result['organisation_assertions'][0]['organisation_size_band'],'unknown');self.assertEqual(result['relevant_links'],['https://business.test/contact'])
 def test_company_description_rejects_event_subordinate_and_product_phrases(self):
  for phrase in ["We're already excited for the2026 Business Excellence Awards.","Whether it is a place to work or a service business.","123worx is an all-in-one Construction Business Management solution.","This is a business."]:
   self.assertFalse(explicit_company_description(phrase),phrase)
   self.assertEqual(extract_contact_context('<main><p>'+phrase+'</p></main>',URL)['organisation_assertions'],[])
 def test_actual_company_descriptions_are_supported(self):
  for phrase in ['We are a locally owned moving company.','Example Ltd is a construction business serving Ontario.','We’re an installation company based in Windsor.']:
   self.assertTrue(explicit_company_description(phrase),phrase)
   self.assertEqual(extract_contact_context('<main><p>'+phrase+'</p></main>',URL)['organisation_assertions'][0]['category'],'company')
 def test_board_section_is_preserved_without_employment_inference(self):
  page='<main><h2>Senior Leadership</h2><div class="team"><h3>Jane Smith</h3><p>CEO</p></div><h2>Board of Directors</h2><div class="team"><h3>Rhonda Leeson</h3><p>Associate Director, SickKids Foundation</p></div><div class="team"><h3>Mark Oaks</h3><p>CFO, Kawartha Credit Union</p></div></main>'
  people=extract_contact_context(page,URL)['people']
  self.assertEqual(len(people),3)
  self.assertEqual(people[0]['source_listing_context'],'Senior Leadership')
  for person in people[1:]:
   self.assertEqual(person['source_listing_context'],'Board of Directors')
   self.assertEqual(person['source_listing_kind'],'board_or_advisory_listing')
   self.assertEqual(person['employment_relationship_status'],'not_established')
   self.assertIsNone(person['published_employer'])
 def test_hidden_role_card_excluded(self):
  result=extract_contact_context('<div class="team" hidden><h3>Jane Smith</h3><p>CEO</p></div>',URL);self.assertEqual(result['people'],[])

if __name__=='__main__':unittest.main()
