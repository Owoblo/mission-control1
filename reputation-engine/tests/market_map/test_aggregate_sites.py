import unittest
from scripts.market_map.aggregate_sites import feature_record, LICENCE
from scripts.market_map.transport import SourceBlocked


class AggregateAreaTests(unittest.TestCase):
    def setUp(self):
        self.metadata={'source_id':'fixture-active','native_object_id_field':'OBJECTID','layer_name':'Active',
                       'native_spatial_reference':{'wkid':4269}}
        self.receipt={'source_checked_at':'2026-10-27','source_body_sha256':'fixture'}

    def test_native_curves_and_zero_limits_are_preserved_without_business_inferences(self):
        feature={'attributes':{'OBJECTID':7,'OGF_ID':12345,'ALPS_ID':123,'CLIENT_NAME':'Example',
                               'MAX_TONNAGE':0,'CURRENT_STATUS':'Active'},
                 'geometry':{'curveRings':[[[1.234567890123,2.345678901234],{'c':[[2,3],[1,2]]}]]}}
        row=feature_record(feature,self.metadata,self.receipt)
        self.assertEqual(row['source_record_id'],'12345')
        self.assertEqual(row['raw_source_attributes']['MAX_TONNAGE'],0)
        self.assertEqual(row['source_native_geometry'],feature['geometry'])
        self.assertFalse(row['current_business_operation_verified'])
        self.assertFalse(row['landownership_verified'])
        self.assertIsNone(row['official_municipality_id'])
        self.assertIsNone(row['source_country'])
        self.assertEqual(row['licence_url'],LICENCE)

    def test_attribute_only_response_does_not_invent_geometry_or_stable_provincial_id(self):
        feature={'attributes':{'OBJECTID':9,'OGF_ID':None,'ALPS_ID':'00042'}}
        row=feature_record(feature,self.metadata,self.receipt,'publisher_omits_row_when_native_geometry_requested_attributes_only_captured')
        self.assertEqual(row['source_record_id'],'objectid:9')
        self.assertEqual(row['source_alps_licence_or_permit_business_id'],'00042')
        self.assertIsNone(row['source_native_geometry'])
        self.assertIn('attributes_only',row['source_geometry_observation_status'])
        self.assertEqual(row['source_identifier_namespace'],'snapshot_ArcGIS_OBJECTID_explicit_fallback')

    def test_missing_native_id_requires_review(self):
        with self.assertRaises(SourceBlocked):feature_record({'attributes':{'OGF_ID':123}},self.metadata,self.receipt)


if __name__=='__main__':unittest.main()
