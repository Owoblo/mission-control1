import unittest
from scripts.market_map.windsor_patterns import patterns


def observation(name, address, url, unit=None, channels=None):
    return {'organization':name,'address':address,'source_url':url,'unit_or_floor':unit,
            'published_contact_channels':channels or []}


class PatternTests(unittest.TestCase):
    def test_separate_tenants_and_units_preserved(self):
        a=observation('Tenant A','12 Main St','https://a.example/', 'Suite 1')
        b=observation('Tenant B','12 Main Street','https://b.example/', 'Suite 2')
        result=patterns([a,b])
        review=result['shared_address_reviews'][0]
        self.assertEqual(len(review['source_observations']),2)
        self.assertEqual({o['unit_or_floor'] for o in review['source_observations']},{'Suite 1','Suite 2'})
        self.assertIn('No current co-occupancy',review['interpretation'])

    def test_directions_not_collapsed(self):
        result=patterns([observation('Alpha','12 Main St E','https://a.example/'),
                         observation('Beta','12 Main St W','https://b.example/')])
        self.assertEqual(result['shared_address_reviews'],[])

    def test_multiple_branches_not_forced_into_move(self):
        result=patterns([observation('Alpha','12 Main St','https://a.example/one'),
                         observation('Alpha','44 King St','https://a.example/two')])
        self.assertEqual(len(result['same_name_multiple_address_reviews']),1)
        self.assertIn('No automatic move',result['same_name_multiple_address_reviews'][0]['interpretation'])

    def test_shared_switchboard_not_an_owner(self):
        channels=[{'type':'phone','value':'519-555-0100'}]
        result=patterns([observation('Alpha','12 Main','https://a.example/',channels=channels),
                         observation('Beta','44 King','https://b.example/',channels=channels)])
        self.assertEqual(len(result['shared_contact_channel_reviews']),1)
        self.assertIn('not proof of common ownership',result['shared_contact_channel_reviews'][0]['interpretation'])


if __name__ == '__main__': unittest.main()
