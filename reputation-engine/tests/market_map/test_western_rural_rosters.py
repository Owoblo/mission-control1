import unittest
from scripts.market_map.western_rural_rosters import parse_elmira
from scripts.market_map.transport import SourceBlocked


class RuralRosterTests(unittest.TestCase):
    def card(self,profile='example'):
        return ('<article class="directorist-listing-single"><h2><a href="/business-directory/'+profile+'/">Example Practice</a></h2>'
                '<li class="directorist-listing-card-address">10 Main Street, Elmira, ON</li>'
                '<li class="directorist-listing-card-phone"><a href="tel:000001">(519) 000-0001</a></li>'
                '<li class="directorist-listing-card-website"><a href="https://third-party.example/review">Review</a></li>'
                '<div class="directorist-listing-category">Service</div><p>Uncollected narrative</p></article>')

    def test_literal_factual_fields_do_not_infer_country_or_primary_domain(self):
        rows,count=parse_elmira(('<b>1 Items Found</b>'+self.card()).encode(),'https://downtownelmira.ca/business-directory/')
        self.assertEqual(count,1);row=rows[0]
        self.assertEqual(row['published_business_phone_strings'],['(519) 000-0001'])
        self.assertEqual(row['published_business_website_urls'],['https://third-party.example/review'])
        self.assertIsNone(row['source_country']);self.assertIsNone(row['publisher_numeric_listing_id'])
        self.assertNotIn('primary_domain',row);self.assertNotIn('narrative',row)
        self.assertFalse(row['physical_site_or_current_occupancy_verified'])

    def test_duplicate_keys_and_missing_publisher_total_need_review(self):
        with self.assertRaises(SourceBlocked):parse_elmira(('<b>2 Items Found</b>'+self.card()+self.card()).encode(),'https://downtownelmira.ca/')
        with self.assertRaises(SourceBlocked):parse_elmira(self.card().encode(),'https://downtownelmira.ca/')


if __name__=='__main__':unittest.main()
