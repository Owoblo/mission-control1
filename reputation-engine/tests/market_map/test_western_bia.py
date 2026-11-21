import json
import unittest

from scripts.market_map.western_bia import parse_waterloo_views,parse_woodstock_api_records,parse_listowel_loaded_view,parse_woodstock_html_inventory
from scripts.market_map.transport import SourceBlocked


def marker(name='Fixture Supply',url='https://uptownwaterloobia.com/business/fixture/',lat='43.4',lon='-80.5'):
    return '<div data-markerlat="'+lat+'" data-markerlon="'+lon+'"><a href="'+url+'">'+name+'</a></div>'


def card(name='Fixture Supply',lat='43.4',lon='-80.5'):
    return '<div class="business-listing-individual"><div class="bus-cat"><a href="/business-category/retail/">Retail</a></div><div class="bus-title">'+name+'''</div>
        <div>10 Fixture Street, Suite2</div><div>Waterloo, N2J 1A1</div><div><a href="tel:5190000000">5190000000</a></div>
        <div class="insta-link"><a href="https://fixture.example"><i class="fa fa-globe"></i></a><a href="https://instagram.com/privateperson"><i class="fa fa-instagram"></i></a></div>
        <div data-markerlat="'''+lat+'" data-markerlon="'+lon+'"><h4>'+name+'</h4></div></div>'


def current(cards,pagination='disabled'):
    return ('<html><body><div data-pagination=\''+json.dumps({'type':pagination,'max_pages':0})+'\'>'+cards+'</div></body></html>').encode()


class WesternBIATests(unittest.TestCase):
    def test_listowel_source_uuid_and_blank_title_do_not_infer_people_or_biography(self):
        native='1226566c-0781-4e84-aee0-ed6f10ecde9a'
        markup='<div class="wixui-repeater__item" id="comp-lpsp505s__'+native+'">'
        for component,text in [('comp-lpsp50602','\u200b'),('comp-lpsp50632','10 Fixture Street'),('comp-lpsp5068','<p>519-111-2222</p><p>Person Example founded this company.</p>')]:
            markup+='<div id="'+component+'__'+native+'">'+text+'</div>'
        markup+='<div role="button"><div data-testid="linkElement" aria-label="https://fixture.example">Website</div></div></div>'
        row=parse_listowel_loaded_view(('<html><body>'+markup+'</body></html>').encode(),{native:{'_owner':'private-user-id','arraystring':['Retail']}})[0]
        self.assertEqual(row['source_record_id'],native)
        self.assertIsNone(row['name'])
        self.assertTrue(row['source_blank_name_requires_review'])
        self.assertEqual(row['business_phone'],'519-111-2222')
        self.assertEqual(row['business_websites'],['https://fixture.example'])
        self.assertNotIn('founded',json.dumps(row))
        self.assertNotIn('private-user-id',json.dumps(row))

    def test_woodstock_html_selects_source_street_and_native_next_only(self):
        markup=b'<div data-post-id="72"><h3><a href="/places/fixture/">Fixture</a></h3><span itemprop="streetAddress">10 Main St</span><p>Personal bio omitted</p></div><a class="next page-link" href="/business-directory/page/2/">Older posts</a>'
        rows,following=parse_woodstock_html_inventory(markup,'https://downtownwoodstock.ca/business-directory/')
        self.assertEqual(rows[0]['published_address']['street'],'10 Main St')
        self.assertEqual(following,['https://downtownwoodstock.ca/business-directory/page/2/'])
        self.assertNotIn('Personal bio',json.dumps(rows))

    def test_woodstock_native_keys_and_unknown_categories_remain_source_claims(self):
        row={'id':72,'link':'https://downtownwoodstock.ca/places/fixture/','title':{'rendered':'Fixture &amp; Supply'},'street':'1 Fixture St','gd_placecategory':[2,9]}
        parsed=parse_woodstock_api_records([row],{2:'Retail'},'2026-10-27',{'source_body_sha256':'example'})[0]
        self.assertEqual(parsed['name'],'Fixture & Supply')
        self.assertEqual(parsed['source_record_id'],'72')
        self.assertEqual(parsed['unresolved_source_category_ids'],[9])
        self.assertIsNone(parsed['business_phone'])
        self.assertFalse(parsed['current_occupancy_verified'])

    def test_woodstock_projection_or_private_status_changes_stop_collection(self):
        row={'id':72,'link':'https://downtownwoodstock.ca/places/fixture/','title':'Fixture','content':'Personal biography'}
        with self.assertRaisesRegex(SourceBlocked,'projection'):parse_woodstock_api_records([row],{},'date',{})
        row.pop('content');row['status']='draft'
        with self.assertRaisesRegex(SourceBlocked,'publicly published'):parse_woodstock_api_records([row],{},'date',{})

    def test_unique_publisher_name_and_point_join_preserves_only_business_facts(self):
        rows,inventory,controls=parse_waterloo_views(marker().encode(),current(card()),'https://uptownwaterloobia.com/business-directory-search-results/')
        self.assertEqual(rows[0]['native_profile_url'],'https://uptownwaterloobia.com/business/fixture/')
        self.assertEqual(rows[0]['business_websites'],['https://fixture.example'])
        self.assertNotIn('instagram',json.dumps(rows))
        self.assertFalse(rows[0]['legal_company_identity_verified'])
        self.assertFalse(rows[0]['reported_coordinates']['verified'])
        self.assertEqual(len(inventory),1)

    def test_ambiguous_and_unmapped_current_rows_remain_without_invented_native_ids(self):
        legacy=(marker()+marker(url='https://uptownwaterloobia.com/business/second/')).encode()
        rows,_,_=parse_waterloo_views(legacy,current(card()+card(name='CurrentOnly',lat='0',lon='0')),'https://uptownwaterloobia.com/business-directory-search-results/')
        self.assertIsNone(rows[0]['native_profile_url'])
        self.assertEqual(len(rows[0]['source_native_profile_candidates']),2)
        self.assertIsNone(rows[1]['native_profile_url'])
        self.assertTrue(rows[1]['source_record_id'].startswith('factual-content-sha256:'))
        self.assertTrue(rows[1]['reported_coordinates']['default_zero_point'])
        self.assertEqual(len(rows),2)

    def test_further_pagination_prevents_false_complete_claim(self):
        with self.assertRaisesRegex(SourceBlocked,'further pagination'):
            parse_waterloo_views(marker().encode(),current(card(),pagination='paged'),'https://uptownwaterloobia.com/')


if __name__=='__main__':unittest.main()
