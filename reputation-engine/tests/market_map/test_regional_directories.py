import json
import unittest

from scripts.market_map.regional_directories import parse_elgin_page,discover_links,parse_woodstock_available_page,parse_woodstock_profile
from scripts.market_map.transport import SourceBlocked


class RegionalFactualDirectoryTests(unittest.TestCase):
    def page(self,count='1',total='1',card=True):
        return ('''<html><body><span class="post-library__counts__offset">1</span>
            <span class="post-library__counts__count">'''+count+'''</span><span class="post-library__counts__total">'''+total+'''</span>
            <select name="sb_business_industry" data-ajax-mapping="taxonomies"><option value="">Industry</option><option value="9">Manufacturing</option></select>'''+('''
            <div class="business-listing"><a class="business-listing__title" href="/business-directory/fixture-supply/">Fixture Supply</a>
            <p>Copyrighted business biography mentioning Owner Private Person, not selected facts.</p>
            <p class="business-listing__contact-field business-listing__contact-field--location">10 Fixture Street<br>Wallacetown<br>ON<br>N0L 2M0</p>
            <a class="business-listing__contact-field--phone" href="tel:519-000-0000">519-000-0000</a>
            <a class="business-listing__contact-field--website" href="https://fixture.example">Our Website</a>
            <a class="business-listing__contact-field--email" href="mailto:private.person@example.org">Private email</a></div>''' if card else '')+'''</body></html>''').encode()

    def test_factual_parser_preserves_published_fields_and_omits_prose_people_email(self):
        counts,rows,filters=parse_elgin_page(self.page(),'https://www.investinelgin.ca/business-directory/')
        self.assertEqual(counts,{'offset':1,'count':1,'total':1})
        self.assertEqual(rows[0]['published_address_lines'],['10 Fixture Street','Wallacetown','ON','N0L 2M0'])
        self.assertEqual(rows[0]['business_phones'],['519-000-0000'])
        self.assertEqual(rows[0]['business_websites'],['https://fixture.example'])
        self.assertIn('https://www.investinelgin.ca/business-directory/fixture-supply/',rows[0]['source_record_id'])
        self.assertIsNone(rows[0]['native_profile_id'])
        self.assertNotIn('Private Person',json.dumps(rows))
        self.assertNotIn('private.person@example.org',json.dumps(rows))
        self.assertEqual(filters['sb_business_industry'],[{'id':'9','label':'Manufacturing'}])
        self.assertIsNone(rows[0]['organisation_size_band'])

    def test_source_range_mismatch_or_foreign_profile_stops_instead_of_claiming_complete(self):
        with self.assertRaisesRegex(SourceBlocked,'range and unique'):
            parse_elgin_page(self.page(count='2',total='2'),'https://www.investinelgin.ca/')
        with self.assertRaisesRegex(SourceBlocked,'native profile route'):
            parse_elgin_page(self.page().replace(b'href="/business-directory/',b'href="https://other.example/business-directory/'),'https://www.investinelgin.ca/')

    def test_duplicate_native_anchors_form_one_inventory_profile(self):
        body=b'<div><a href="/business-directory/fixture/">Fixture</a><a href="/business-directory/fixture/">Read</a></div>'
        _,profiles=discover_links(body,'https://www.investinelgin.ca/business-directory/','elgin')
        self.assertEqual(len(profiles),1)
        self.assertEqual(profiles[0]['name'],'Fixture')

    def test_woodstock_initial_facts_and_saved_profile_do_not_need_blocked_filter(self):
        url='https://www.cityofwoodstock.ca/business-directory/details/?directoryId=publisher-native-1'
        body=('''<ul><li class="gs-feed-list-item" data-phone="5190000000" data-website-url="https://fixture.example">
            <a class="gs-feed-list-title" href="'''+url+'''">Fixture Supply</a><span class="bd-address">10 Fixture St, Woodstock ON</span>
            <button class="bd-view-on-map" data-lat="43.1" data-lng="-80.7">Map</button><p>Narrative and Owner Private Person.</p></li></ul>''').encode()
        row=parse_woodstock_available_page(body,'https://www.cityofwoodstock.ca/business-directory/')[0]
        self.assertEqual(row['native_profile_id'],'publisher-native-1')
        self.assertFalse(row['reported_coordinates']['verified'])
        self.assertNotIn('Private Person',json.dumps(row))
        profile=b'<html><body><main><h1>Fixture Supply</h1><div class="bd-details-sidebar"><div class="bd-address">10 Fixture St<br>Woodstock, Ontario<br>N4S 1A1<br><a>Get directions</a></div></div><p>Biography excluded.</p></main></body></html>'
        detail=parse_woodstock_profile(profile,url)
        self.assertEqual(detail['published_address_lines'],['10 Fixture St','Woodstock, Ontario','N4S 1A1'])
        self.assertNotIn('Biography',json.dumps(detail))
        with self.assertRaisesRegex(SourceBlocked,'path/host differs'):
            parse_woodstock_available_page(body.replace(b'https://www.cityofwoodstock.ca/business-directory/details/',b'https://other.example/business-directory/details/'),'https://www.cityofwoodstock.ca/')


if __name__=='__main__':unittest.main()
