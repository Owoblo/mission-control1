import hashlib
import unittest

from scripts.market_map.logo_inventory import inventory_logos


class LogoInventoryTests(unittest.TestCase):
    def scan(self, body, **options):
        return inventory_logos(body, page_url='https://fixture.example/partners/',
                               source_id='fixture-partners', **options)

    def test_blank_alt_link_and_unlinked_unknown_are_retained_without_guessed_names(self):
        body = b'''<h1>Our Partners</h1><div id="grid"><a href="https://named-domain.example/">
            <img alt="" src="/recognizable-company-logo.png"></a><img data-src="/unknown.png"></div>'''
        result = self.scan(body, scope_xpath='//*[@id="grid"]')
        self.assertEqual(result['counts']['scoped_img_elements'], 2)
        self.assertEqual(result['counts']['scoped_identity_unknown'], 2)
        first, second = result['all_images']
        self.assertEqual(first['ancestor_anchor']['resolved_href'], 'https://named-domain.example/')
        self.assertTrue(first['alt_attribute_present'])
        self.assertFalse(second['alt_attribute_present'])
        self.assertIsNone(second['ancestor_anchor'])
        for row in [first, second]:
            self.assertEqual(row['disposition'], 'held_identity_unknown')
            self.assertIsNone(row['resolved_organisation_name'])
            self.assertFalse(row['filename_domain_or_visual_identity_inferred'])
        self.assertEqual(result['eligible_partner_claims'], [])

    def test_all_page_images_separate_from_reviewed_scope(self):
        result = self.scan('<img alt="Site logo"><section id="grid"><img title="Company A"></section><img alt="Footer">',
                           scope_xpath='//*[@id="grid"]')
        self.assertEqual(result['counts']['all_img_elements'], 3)
        self.assertEqual(result['counts']['scoped_img_elements'], 1)
        self.assertEqual([x['disposition'] for x in result['all_images']],
                         ['outside_requested_logo_scope', 'source_label_candidate_requires_review', 'outside_requested_logo_scope'])
        self.assertEqual(result['counts']['eligible_partner_claims'], 0)

    def test_exact_page_hash_lazy_attributes_context_and_stable_ids(self):
        body = b'''<h2>Suppliers</h2><section id="grid"><a href="../supplier" title="Source label">
            <img data-src="/a.svg" data-company="Printed label" data-custom="kept" srcset="a.svg 1x, b.svg 2x"></a></section>'''
        a = self.scan(body, scope_xpath='//*[@id="grid"]')
        b = self.scan(body, scope_xpath='//*[@id="grid"]', observed_at='later')
        row = a['all_images'][0]
        self.assertEqual(a['source_page_sha256'], hashlib.sha256(body).hexdigest())
        self.assertEqual(row['image_occurrence_id'], b['all_images'][0]['image_occurrence_id'])
        self.assertNotEqual(row['image_occurrence_id'], self.scan(body + b' ', scope_xpath='//*[@id="grid"]')['all_images'][0]['image_occurrence_id'])
        self.assertEqual(row['data_attributes']['data-custom'], 'kept')
        self.assertEqual(row['resource_candidates'][0]['resolved_url'], 'https://fixture.example/a.svg')
        self.assertEqual(row['nearest_heading']['text'], 'Suppliers')
        self.assertTrue(row['dom_locator'].endswith('/img'))
        self.assertEqual(row['ancestor_anchor']['resolved_href'], 'https://fixture.example/supplier')
        self.assertEqual(row['source_label_candidates'][0]['value'], 'Printed label')

    def test_grid_slots_count_empty_and_responsive_occurrences_without_company_inference(self):
        body = '''<table><tr><td>Unrelated</td></tr></table><div id="grid">
          <table><tr><td><picture><source srcset="a.webp"><img alt="A" src="a.png"></picture><img alt="A" src="a-mobile.png"></td></tr></table>
          <table><tr><td>No image saved</td></tr></table></div>'''
        result = self.scan(body, scope_xpath='//*[@id="grid"]', grid_item_xpath='.//table', expected_grid_count=3)
        self.assertEqual(result['counts']['selected_grid_slots'], 2)
        self.assertEqual(result['grid_slots'][0]['image_occurrences'], 3)
        self.assertEqual(result['grid_slots'][1]['disposition'], 'held_no_image_candidate')
        self.assertEqual(result['grid_comparison']['status'], 'mismatch_requires_review')
        self.assertEqual(result['grid_comparison']['missing_expected_slot_count'], 1)
        self.assertEqual(result['organisations_created'], 0)

    def test_supplied_expected_count_does_not_become_observed_grid_count(self):
        result = self.scan('<img alt="A">', expected_grid_count=25)
        self.assertIsNone(result['grid_comparison']['observed_grid_slots'])
        self.assertEqual(result['grid_comparison']['status'], 'held_grid_slot_selector_required')
        self.assertEqual(result['all_images'][0]['disposition'], 'held_scope_unspecified')
        self.assertEqual(result['coverage_status'], 'review_required')

    def test_inline_svg_css_lazy_marker_and_image_without_src_are_audited(self):
        body = '''<div id="grid"><svg role="img"><title>SVG Company</title><path d="M0 0"></path></svg>
          <div style="background-image:url('/background.svg')"></div>
          <div class="logo" data-lazy="/later.svg"></div><img>
          <object type="image/svg+xml" data="/object.svg"></object></div>'''
        result = self.scan(body, scope_xpath='//*[@id="grid"]')
        self.assertEqual({x['image_kind'] for x in result['all_images']},
                         {'inline_svg', 'inline_style_image', 'logo_marker', 'img', 'embedded_image'})
        self.assertEqual(result['all_images'][0]['source_label_candidates'][0]['value'], 'SVG Company')
        self.assertEqual(result['all_images'][1]['resource_candidates'][0]['resolved_url'], 'https://fixture.example/background.svg')
        self.assertEqual(result['all_images'][3]['resource_candidates'], [])

    def test_zero_scope_match_is_a_review_hold(self):
        result = self.scan('<img alt="A">', scope_xpath='//*[@id="missing"]', grid_item_xpath='.//table', expected_grid_count=0)
        self.assertIn('logo_scope_selector_matched_zero_elements', result['review_issues'])
        self.assertEqual(result['coverage_status'], 'review_required')

    def test_invalid_selectors_or_count_are_rejected(self):
        for options in [{'scope_xpath': 'count(//img)'}, {'scope_xpath': '//['},
                        {'expected_grid_count': -1}, {'expected_grid_count': True}]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.scan('<img>', **options)

    def test_text_unicode_and_generic_logo_label_are_not_invented_company_names(self):
        result = self.scan('<div id="grid"><img alt="Logo"><img alt="Compagnie française"></div>', scope_xpath='//*[@id="grid"]')
        self.assertEqual(result['all_images'][0]['disposition'], 'held_identity_unknown')
        self.assertEqual(result['all_images'][1]['source_label_candidates'][0]['value'], 'Compagnie française')
        self.assertEqual(result['page_hash_input'], 'provided_text_utf8')

    def test_comments_do_not_hide_following_unnamed_image(self):
        result = self.scan('<!-- saved source comment --><div id="grid"><!-- lazy image --><img alt=""></div>', scope_xpath='//*[@id="grid"]')
        self.assertEqual(result['counts']['scoped_img_elements'], 1)
        self.assertEqual(result['all_images'][0]['disposition'], 'held_identity_unknown')

    def test_filename_alt_preserved_but_not_treated_as_identity_label(self):
        result = self.scan('<div id="grid"><img alt="Known-Company-logo.png" src="/same.png"></div>', scope_xpath='//*[@id="grid"]')
        row = result['all_images'][0]
        self.assertEqual(row['source_label_candidates'][0]['value'], 'Known-Company-logo.png')
        self.assertTrue(row['source_label_candidates'][0]['filename_like_label'])
        self.assertEqual(row['disposition'], 'held_identity_unknown')

    def test_non_data_lazy_src_resource_is_preserved(self):
        result = self.scan('<img lazy-src="/lazy.svg">')
        self.assertEqual(result['all_images'][0]['resource_candidates'],
                         [{'attribute': 'lazy-src', 'value': '/lazy.svg', 'resolved_url': 'https://fixture.example/lazy.svg'}])


if __name__ == '__main__':
    unittest.main()
