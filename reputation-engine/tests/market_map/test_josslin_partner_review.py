import unittest

from scripts.market_map.josslin_partner_review import enumerate_grid, spreadsheet_cell
from scripts.market_map.transport import SourceBlocked


class JosslinPartnerReviewTests(unittest.TestCase):
    def test_csv_blank_stays_blank_and_formulas_are_escaped(self):
        self.assertEqual(spreadsheet_cell(''), '')
        self.assertIsNone(spreadsheet_cell(None))
        self.assertEqual(spreadsheet_cell('=SUM(A1)'), "'=SUM(A1)")
        self.assertEqual(spreadsheet_cell('Ordinary label'), 'Ordinary label')

    def page(self, slots):
        return ('<html><body><a href="https://utility.test"><img alt="Pet Insurance"></a>'
                '<div class="SiteCM3 Page107497"><h1>Our Partners</h1>'
                '<p>Josslin is pleased to have partnered with leaders in the industry</p>'
                + slots + '</div><img src="footer.png"></body></html>').encode()

    def test_empty_alt_missing_alt_and_unlinked_slots_retained(self):
        body = self.page('<table><tr><td><a href="https://published.test" title="Published Mutual">'
                         '<img alt="" src="a.png"></a></td></tr></table>'
                         '<table><tr><td><img src="unknown.png"></td></tr></table>')
        rows, all_images = enumerate_grid(body, page_url='https://source.test/partners', expected_count=2)
        self.assertEqual(all_images, 4)
        self.assertEqual(rows[0]['published_img_alt'], '')
        self.assertEqual(rows[0]['published_anchor_title'], 'Published Mutual')
        self.assertEqual(rows[0]['object_website'], 'https://published.test')
        self.assertIsNone(rows[1]['published_img_alt'])
        self.assertIsNone(rows[1]['object_website'])
        self.assertEqual(rows[1]['source_element_ordinal'], 2)

    def test_count_change_never_claims_complete(self):
        with self.assertRaises(SourceBlocked):
            enumerate_grid(self.page('<table><img src="a.png"></table>'),
                           page_url='https://source.test', expected_count=25)

    def test_source_scope_and_context_required(self):
        with self.assertRaises(SourceBlocked):
            enumerate_grid(b'<h1>Our Partners</h1><img src="logo.png">', page_url='https://source.test')


if __name__ == '__main__':
    unittest.main()
