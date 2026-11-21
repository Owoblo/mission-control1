import unittest
from scripts.market_map.source_contact_candidates import extract

class ContactTests(unittest.TestCase):
    def test_literal_contacts_deduplicated_without_authority_claim(self):
        source={'url':'https://example.org','body_sha256':'digest',
                'text':'Ops Jane ops@example.org, fax (519) 250-3894. Again ops@example.org.'}
        rows=extract(source)
        self.assertEqual(len(rows),2)
        for row in rows:
            self.assertEqual(source['text'][row['text_start']:row['text_end']],row['literal_value'])
            self.assertFalse(row['outreach_eligible'])
            self.assertEqual(row['organization_scope'],'requires_review')
    def test_names_and_formats_do_not_generate_contact(self):
        self.assertEqual(extract({'url':'https://example.org','body_sha256':'digest',
                                  'text':'Jane Smith. Our format is first dot last at our domain.'}),[])

if __name__=='__main__':unittest.main()
