import unittest
from scripts.market_map.legacy_published_emails import profile_fields, chamber_fields


class LegacyPublishedEmailTests(unittest.TestCase):
    def test_publisher_publication_flag_required_and_role_aliases_preserved(self):
        profile = {'isPublished': False, 'contactDetails': {'email': 'info@business.test'}}
        self.assertEqual(profile_fields(profile), {})
        profile['isPublished'] = True;profile['contactDetails']['salesEmail'] = 'info@business.test'
        facts = profile_fields(profile);self.assertEqual(len(facts), 1)
        self.assertEqual(facts['info@business.test']['fields'], ['/contactDetails/email', '/contactDetails/salesEmail'])

    def test_only_raw_text_or_mailto_supported_chamber_candidates(self):
        record = {'emails': ['visible@business.test', 'mailto@business.test', 'unsupported@business.test'],
            'text': 'Public email: visible@business.test', 'links': [{'href': 'mailto:mailto@business.test'}]}
        self.assertEqual(set(chamber_fields(record)), {'visible@business.test', 'mailto@business.test'})


if __name__ == '__main__': unittest.main()
