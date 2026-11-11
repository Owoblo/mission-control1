import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from market_map.email_extraction import extract_published_emails, clean_email


class EmailExtractionTests(unittest.TestCase):
    def extract(self, text):
        return extract_published_emails(text.encode(), "https://business.test/contact")

    def test_mailto_multiple_recipients_excludes_message_body_and_crlf_injection(self):
        rows = self.extract('<a href="mailto:info@business.test;sales@business.test?subject=ask&amp;body=ignore@other.test">Contact</a><a href="mailto:bad@business.test%0d%0aBcc:private@other.test">Bad</a>')
        self.assertEqual({r['email'] for r in rows}, {'info@business.test', 'sales@business.test'})

    def test_visible_generic_and_free_mail_all_retained_with_separate_roles(self):
        rows = self.extract('<p>hello@business.test, owner@email.com, purchasing@business.test and jobs@business.test</p>')
        self.assertEqual(len(rows), 4)
        self.assertEqual(next(r for r in rows if r['email'].startswith('purchasing'))['role_hint'], 'procurement')
        self.assertTrue(all(r['mailbox_status'] == 'not_checked' for r in rows))

    def test_scripts_assets_placeholders_hidden_subtrees_excluded(self):
        rows = self.extract('<script>var x="junk@business.test";</script><p>image@2x.png info@example.com</p><div hidden><p>hidden@business.test</p></div><p>good@business.test</p>')
        self.assertEqual([r['email'] for r in rows], ['good@business.test'])

    def test_public_obfuscation_and_organisation_jsonld_are_evidenced(self):
        address='office@business.test';key=42
        encoded=bytes([key]+[ord(x)^key for x in address]).hex()
        rows = self.extract('<a data-cfemail="'+encoded+'">[email protected]</a><p>sales [at] business [dot] test</p><script type="application/ld+json">'+json.dumps({'@type':'Organization','email':'facilities@business.test'})+'</script>')
        self.assertEqual(len(rows),3)
        self.assertIn('public_cfemail_presentation',next(r for r in rows if r['email']==address)['extraction_methods'])
        self.assertTrue(all(r['page_content_sha256'] for r in rows))

    def test_vendor_and_privacy_contacts_never_become_verified_org_contacts(self):
        rows=self.extract('<p>Website designed by <a href="mailto:hello@agency.test">Agency</a></p><p>privacy@business.test</p>')
        self.assertEqual(next(r for r in rows if r['email'].endswith('agency.test'))['association_status'],'possible_website_vendor_contact_requires_review')
        self.assertEqual(next(r for r in rows if r['email'].startswith('privacy'))['role_hint'],'privacy_legal')
        self.assertTrue(all(r['ownership_status']=='not_checked' for r in rows))

    def test_preserve_local_part_case_and_reject_invalid_structure(self):
        self.assertEqual(clean_email('Sales@Business.TEST'),'Sales@business.test')
        self.assertIsNone(clean_email('double..dot@business.test'))
        self.assertIsNone(clean_email('name@business.test\r\nBcc:x@other.test'))

    def test_comments_excluded_and_visible_tails_of_hidden_nodes_retained(self):
        rows = self.extract('<div><!-- private@business.test -->visible@business.test <span hidden>hidden@business.test</span> tail@business.test</div>')
        self.assertEqual({r['email'] for r in rows}, {'visible@business.test', 'tail@business.test'})

    def test_new_embedded_and_email_button_formats(self):
        cases = [
            '<script type="application/ld+json">{"@type":"Person","name":"Jane","email":"jane@business.test"}</script>',
            '<script type="application/json">{"props":{"team":[{"emailAddress":"jane@business.test"}]}}</script>',
            '<button data-email="jane&#64;business.test">Email</button>',
            '<meta itemprop="email" content="jane@business.test">',
            '''<script>document.getElementById("email").onclick=function(){var email="mailto:jane".concat("@","business.test");location.href=email;}</script>''',
            '''<button onclick="location.href='mailto:'+'jane'+'@business.test';">Email</button>''',
        ]
        for markup in cases:
            with self.subTest(markup=markup):
                rows=self.extract(markup)
                self.assertEqual([r['email'] for r in rows],['jane@business.test'])
                self.assertEqual(rows[0]['outreach_eligibility'],'research_only')
                self.assertEqual(rows[0]['ownership_status'],'not_checked')
                self.assertEqual(rows[0]['extraction_version'],'ssm-published-email-extraction/6')

    def test_no_guesses_private_strings_or_binary_matches(self):
        cases = [
            '<p>Jane Smith works for Business at business.test</p>',
            '<script type="application/json">{"name":"Jane","domain":"business.test","debug":"debug@business.test"}</script>',
            '''<button onclick="location.href='mailto:'+name+'@business.test'">Email</button>''',
            '''<button onclick="location.href='mailto:jane@business.test'+suffix">Email</button>''',
            '<button hidden data-email="hidden@business.test">Email</button>',
            '%PDF-1.4 random@binary.test',
            '',
        ]
        for markup in cases:
            with self.subTest(markup=markup):self.assertEqual(self.extract(markup),[])

    def test_embedded_fields_need_display_review(self):
        rows=self.extract('<script type="application/json">{"email":"jane@business.test"}</script>')
        self.assertIn('embedded_json_email_field_requires_display_review',rows[0]['extraction_methods'])


if __name__=='__main__':
    unittest.main()
