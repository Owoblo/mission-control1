import unittest
from scripts.market_map.windsor_bia_addresses import parse


class BiaAddresses(unittest.TestCase):
    def test_unit_and_direction_retained(self):
        result = parse('<h1 class="sr-only">A &amp; B</h1><div class="location"><p>12 Main St W, Suite 2</p><p>Windsor, ON</p></div>')
        self.assertEqual(result['organization'], 'A & B')
        self.assertEqual(result['address'], '12 Main St W, Suite 2')

    def test_missing_or_other_city_not_imported(self):
        for body in ('<html>Blocked</html>', '<h1 class="sr-only">A</h1><div class="location"><p>12 Main</p><p>Toronto, ON</p></div>'):
            with self.assertRaises(ValueError):
                parse(body)

    def test_multiple_locations_not_flattened(self):
        with self.assertRaises(ValueError):
            parse('<h1 class="sr-only">A</h1>' + '<div class="location"><p>12 Main</p><p>Windsor, ON</p></div>' * 2)

    def test_postal_code_suffix_is_valid_but_other_city_is_not(self):
        body = '<h1 class="sr-only">Gallery</h1><div class="location"><p>401 Riverside Dr W</p><p>Windsor, ON, N9A 7J9</p></div>'
        self.assertEqual(parse(body)['address'], '401 Riverside Dr W')
        with self.assertRaises(ValueError): parse(body.replace('Windsor,', 'Windsor Heights,'))

    def test_contacts_only_from_listing_contact_panel(self):
        body = '<h1 class="sr-only">A</h1><div class="location"><p>12 Main St</p><p>Windsor, ON</p></div>'
        body += '<div class="contact"><a href="tel:519-123-4567">519-123-4567</a><a href="https://example.com/">Website</a><a href="mailto:business@example.com">Email</a></div>'
        body += '<footer><a href="mailto:directory@example.com">Directory office</a></footer><input name="resident_email">'
        contacts = parse(body)['published_contact_channels']
        self.assertEqual({c['type'] for c in contacts}, {'phone','website','email'})
        self.assertEqual(len(contacts), 3)
        self.assertNotIn('directory@example.com', str(contacts))


if __name__ == '__main__':
    unittest.main()
