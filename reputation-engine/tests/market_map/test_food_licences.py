import unittest
from scripts.market_map.food_licences import normalise_dairy_rows,DAIRY_HEADER
from scripts.market_map.transport import SourceBlocked


class FoodLicenceTests(unittest.TestCase):
    def source(self):
        return {'source_catalogue_temporal_reference':'2026-07-16','source_filename_reference_hint':'FilenameJul15; exact observation date not established',
            'raw_receipt':{'checked_at':'2026-10-27','source_body_sha256':'fixture'},'source_url':'https://data.ontario.ca/offered.csv',
            'licence':{'url':'https://www.ontario.ca/page/open-government-licence-ontario'}}

    def test_regulatory_ID_preserves_leading_zero_and_does_not_infer_country_or_operation(self):
        rows=[DAIRY_HEADER,['093103','Fixture Dairy (Ottawa)','10 Dairy Drive','OTTAWA','K4A 3N3','(613) 111-2222']]
        record=normalise_dairy_rows(rows,self.source())[0]
        self.assertEqual(record['source_record_id'],'093103')
        self.assertIsNone(record['source_country']);self.assertIsNone(record['source_province'])
        self.assertIsNone(record['official_municipality_id']);self.assertIsNone(record['naics'])
        self.assertIsNone(record['organisation_size_band'])
        self.assertFalse(record['physical_operating_site_verified'])
        self.assertEqual(record['current_licensing_status'],'not_verified')
        self.assertEqual(record['source_raw_fields'][DAIRY_HEADER[0]],'093103')

    def test_duplicate_or_changed_schema_requires_review_instead_of_fabricating_keys(self):
        row=['093103','Fixture Dairy','10 Dairy Drive','OTTAWA','K4A 3N3','6131112222']
        with self.assertRaisesRegex(SourceBlocked,'repeats'):normalise_dairy_rows([DAIRY_HEADER,row,row],self.source())
        with self.assertRaisesRegex(SourceBlocked,'header'):normalise_dairy_rows([['Licence','Business'],row],self.source())


if __name__=='__main__':unittest.main()
