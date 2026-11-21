import json
import unittest
from scripts.market_map.western_bia_guelph import parse_api_page,parse_archive
from scripts.market_map.transport import SourceBlocked


class GuelphBIATests(unittest.TestCase):
    def test_native_facts_keep_missing_city_and_invalid_coordinates_unknown(self):
        data=[{'id':72,'link':'https://downtownguelph.com/places/fixture/','title':{'rendered':'Fixture &amp; Supply'},'street':'1 Main St',
            'gd_placecategory':[2,8],'latitude':'nan','longitude':'-80.2','business_hours':{'raw':'Mon 9-5'}}]
        row=parse_api_page(data,{2:'Shopping'})[0]
        self.assertEqual(row['name'],'Fixture & Supply')
        self.assertIsNone(row['publisher_reported_address']['city'])
        self.assertFalse(row['publisher_reported_coordinate_context']['format_valid'])
        self.assertFalse(row['publisher_reported_coordinate_context']['verified'])
        self.assertEqual(row['unresolved_native_category_ids'],[8])
        self.assertFalse(row['current_occupancy_verified'])

    def test_unexpected_narrative_projection_stops_before_structuring(self):
        with self.assertRaisesRegex(SourceBlocked,'projection'):
            parse_api_page([{'id':1,'content':'Private biography'}],{})

    def test_native_archive_preserves_company_card_facts_without_following_maps(self):
        body=b'''<html><article id="post-72" class="elementor-post gd_place"><h1><a href="https://downtownguelph.com/places/fixture/">Fixture</a></h1>
        <a href="https://maps.google.com/?daddr=43.5,-80.2">1 Main Street</a><a href="tel:5191112222">5191112222</a>
        <a href="https://fixture.example">Website</a></article><div class="nav-next"><a href="https://downtownguelph.com/places/page/2/">Next</a></div></html>'''
        rows,following=parse_archive(body,'https://downtownguelph.com/places/')
        self.assertEqual(rows[0]['source_record_id'],'72')
        self.assertEqual(rows[0]['published_street_texts'],['1 Main Street'])
        self.assertEqual(rows[0]['business_websites'],['https://fixture.example'])
        self.assertNotIn('maps.google',json.dumps(rows))
        self.assertEqual(following,'https://downtownguelph.com/places/page/2/')


if __name__=='__main__':unittest.main()
