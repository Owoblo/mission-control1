import unittest

from scripts.market_map.eastern_saved_emails import parse_published_email_fields


class SavedEasternEmailTests(unittest.TestCase):
    def card(self, native, email):
        return '<div id="wpbdp-listing-' + native + '"><div class="listing-title"><h3><a href="/listings/' + native + '/business/">Published Business</a></h3></div><div class="wpbdp-field-display"><span class="field-label">Business Contact Email</span><div><a href="mailto:' + email + '?subject=Ignored">' + email + '</a></div></div></div>'

    def parse(self, body):
        return parse_published_email_fields(body.encode(), 'https://publisher.test/listings/', '2026-10-27T00:00:00Z', artifact_sha256='PINNED', rights_status='limited_factual_review_only')

    def test_mailto_and_display_are_one_exact_association_without_footer_or_biography(self):
        rows, fields = self.parse(self.card('12', 'Public+Business@Example.org') + '<footer>unrelated@example.org</footer><div>person-biography@example.org</div>')
        self.assertEqual((len(rows), fields), (1, 1));self.assertEqual(rows[0]['email'], 'public+business@example.org')
        self.assertEqual(rows[0]['email_as_published'], 'Public+Business@Example.org');self.assertEqual(rows[0]['source_record_id'], '12')
        self.assertEqual(rows[0]['mailbox_status'], 'not_checked');self.assertEqual(rows[0]['outreach_eligibility'], 'research_only')
        self.assertFalse(rows[0]['person_name_or_role_inferred'])

    def test_shared_email_keeps_two_publisher_record_associations(self):
        rows, fields = self.parse(self.card('12', 'shared@example.org') + self.card('13', 'shared@example.org'))
        self.assertEqual(len(rows), 2);self.assertEqual(len({r['email'] for r in rows}), 1)
        self.assertEqual({r['source_record_id'] for r in rows}, {'12', '13'})

    def test_different_display_and_mailto_are_preserved_as_competing_published_candidates(self):
        body = self.card('12', 'one@example.org').replace('>one@example.org</a>', '>two@example.org</a>')
        rows, fields = self.parse(body);self.assertEqual({r['email'] for r in rows}, {'one@example.org', 'two@example.org'})


if __name__ == '__main__': unittest.main()
