import json
import unittest
from scripts.market_map.western_towns import parse_tillsonburg_index,native_tillsonburg_id,parse_tillsonburg_profile
from scripts.market_map.transport import SourceBlocked


def page(following='/includes/get-businesses.php?page=2&pages=47'):
    marker={'lat':'42.8','lng':'-80.7','info':'<div><h5><a href="/business-profile.php?id=72">Fixture Supply</a></h5><p>1 Main Street</p><a href="https://www.google.com/maps/dir/">Directions</a></div>'}
    body='''<html><meta charset="utf-8"><div>932 listings found</div><div class="custom-table-row"><div class="custom-table-cell"><a href="/business-profile.php?id=72">Fixture Supply</a><small><br>1 Main Street<br>Tillsonburg, Ontario</small></div><div class="custom-table-cell"><strong>Phone: </strong>519-111-2222</div><div class="custom-table-cell"><a href="https://fixture.example">Website</a></div></div>'''
    if following:body+='<a id="load_more" href="'+following+'">load more +</a>'
    body+='<script>const locations = '+json.dumps([marker])+'; function initMap(){ /* source map code is never executed */ }</script></html>'
    return body.encode()


class WesternTownTests(unittest.TestCase):
    def test_detail_fields_are_source_claims_and_description_people_are_excluded(self):
        fields=[('Company Name','Radio Fixture'),('Address','10 Main St'),('Primary NAICS','541110 - Offices of lawyers'),('Number of Employees','5'),('Company Description','Private narrative and Person Example'),('Contact Person','Name Never Collected')]
        body='<html>'+''.join('<div class="custom-table-row"><div class="custom-table-cell">'+label+'</div><div class="custom-table-cell"><strong>'+label+': </strong>'+value+'</div></div>' for label,value in fields)+'</html>'
        row=parse_tillsonburg_profile(body.encode(),'72')
        self.assertEqual(row['source_profile_primary_naics_code'],'541110')
        self.assertIsNone(row['source_profile_naics_version'])
        self.assertTrue(row['source_profile_classification_not_independently_verified'])
        self.assertIsNone(row['source_profile_company_size_band'])
        self.assertNotIn('Name Never Collected',json.dumps(row))
        self.assertNotIn('Private narrative',json.dumps(row))
        self.assertEqual(row['uncollected_new_field_labels'],['Contact Person'])

    def test_native_rows_and_map_context_remain_separate_unverified_source_claims(self):
        rows,following,count,markers=parse_tillsonburg_index(page(),'https://businessdirectory.tillsonburg.ca/search-results.php')
        self.assertEqual(count,932);self.assertEqual(rows[0]['source_record_id'],'72')
        self.assertEqual(rows[0]['published_address_lines'],['1 Main Street','Tillsonburg, Ontario'])
        self.assertEqual(rows[0]['business_phone'],'519-111-2222')
        self.assertFalse(rows[0]['current_occupancy_verified'])
        self.assertEqual(markers[0]['coordinate_verification_status'],'publisher_reported_unverified')
        self.assertNotIn('google.com',json.dumps(markers))
        self.assertIn('/includes/get-businesses.php?',following)

    def test_native_load_more_cannot_switch_source_host(self):
        with self.assertRaisesRegex(SourceBlocked,'leaves documented'):
            parse_tillsonburg_index(page('https://other.example/includes/get-businesses.php?page=2'),'https://businessdirectory.tillsonburg.ca/search-results.php')

    def test_native_profile_ids_must_be_unambiguous_source_ids(self):
        with self.assertRaises(SourceBlocked):native_tillsonburg_id('https://businessdirectory.tillsonburg.ca/business-profile.php?id=1&id=2')
        with self.assertRaises(SourceBlocked):native_tillsonburg_id('https://other.example/business-profile.php?id=72')


if __name__=='__main__':unittest.main()
