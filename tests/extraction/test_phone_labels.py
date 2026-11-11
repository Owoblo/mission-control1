import unittest
from scripts.market_map.phone_extraction import extract_published_phones


class PhoneLabelTests(unittest.TestCase):
    def rows(self, body):
        return extract_published_phones(body, 'https://fictional.test/contact')

    def assert_kinds(self, body, expected):
        rows = self.rows(body)
        self.assertTrue(rows)
        self.assertEqual({(r['phone'], r['kind']) for r in rows}, expected)
        return rows

    def test_adjacent_and_nested_labels_apply_to_link_and_visible_observation(self):
        for label in ['Fax: ', '<span>Fax:</span> ', '<strong>Fax</strong>: ']:
            rows = self.assert_kinds('<p>' + label + '<a href="tel:5195550123"><span>519-555-0123</span></a></p>', {('+15195550123', 'fax')})
            self.assertEqual({r['extraction_method'] for r in rows}, {'tel_link', 'visible_text'})

    def test_two_numbers_in_one_field_use_nearest_label(self):
        for first, second in [('Phone', 'Fax'), ('Fax', 'Phone')]:
            body = '<p>' + first + ': <a href="tel:5195550123">519-555-0123</a> ' + second + ': <a href="tel:5195550124">519-555-0124</a></p>'
            self.assert_kinds(body, {('+15195550123', first.lower()), ('+15195550124', second.lower())})

    def test_table_rows_and_separate_cards_do_not_leak(self):
        self.assert_kinds('<table><tr><th>Fax</th><td><a href="tel:5195550124">519-555-0124</a></td></tr><tr><th>Phone</th><td>519-555-0123</td></tr></table>', {('+15195550124', 'fax'), ('+15195550123', 'phone')})
        self.assert_kinds('<div><p>Fax: 519-555-0124</p><p><a href="tel:5195550123">519-555-0123</a></p></div>', {('+15195550124', 'fax'), ('+15195550123', 'phone')})

    def test_trailing_label_and_plain_text_field(self):
        for body in ['<p><a href="tel:5195550123">519-555-0123</a> (Fax)</p>', '<p><b>Fax:</b> 519-555-0123</p>', '<p>519-555-0123 (Fax)</p>']:
            self.assert_kinds(body, {('+15195550123', 'fax')})

    def test_conflicting_labels_are_held_for_legacy_filters(self):
        for body in ['<p>Phone/Fax: <a href="tel:5195550123">519-555-0123</a></p>', '<p>Phone: <a href="tel:5195550123">519-555-0123 Fax</a></p>']:
            rows = self.assert_kinds(body, {('+15195550123', 'fax')})
            self.assertTrue(all(r['kind_review_required'] for r in rows))

    def test_same_number_published_as_phone_and_fax_stays_distinct(self):
        self.assert_kinds('<p>Phone: 519-555-0123</p><p>Fax: 519-555-0123</p>', {('+15195550123', 'phone'), ('+15195550123', 'fax')})

    def test_br_prose_hidden_labels_and_neighbor_cards_do_not_label_phone(self):
        for body in ['<div>Fax support available. <a href="tel:5195550123">519-555-0123</a></div>', '<p>Fax:<br><a href="tel:5195550123">519-555-0123</a></p>', '<p><span hidden>Fax:</span><a href="tel:5195550123">519-555-0123</a></p>', '<div><div>Fax:</div><div><a href="tel:5195550123">519-555-0123</a></div></div>']:
            self.assert_kinds(body, {('+15195550123', 'phone')})

    def test_comment_tail_and_microdata_fax_have_no_ordinary_duplicate(self):
        self.assert_kinds('<p><!-- note -->Fax: 519-555-0123</p>', {('+15195550123', 'fax')})
        self.assert_kinds('<p><a itemprop="faxNumber" href="tel:5195550123">519-555-0123</a></p>', {('+15195550123', 'fax')})

    def test_conflicting_microdata_label_does_not_leak_ordinary_duplicate(self):
        rows = self.assert_kinds('<p>Fax: <a itemprop="telephone" href="tel:5195550123">519-555-0123</a></p>', {('+15195550123', 'fax')})
        self.assertTrue(all(r['kind_review_required'] for r in rows))
        self.assert_kinds('<span itemprop="faxNumber" content="5195550123"></span>', {('+15195550123', 'fax')})
        self.assert_kinds('<p><span hidden>Fax:</span><a itemprop="telephone" href="tel:5195550123">519-555-0123</a></p>', {('+15195550123', 'phone')})
