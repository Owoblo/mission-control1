import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from market_map.windsor_physical import validate_page
from market_map.windsor_physical_report import esri_shape, grid, covering, commercial_code_flag
from shapely.geometry import Point, box
from shapely.ops import unary_union
from shapely.strtree import STRtree

class PhysicalTests(unittest.TestCase):
    def test_commercial_flag_preserves_mixed_zoning_without_inventing_use(self):
        self.assertTrue(commercial_code_flag('RD1.3, CD2.2'))
        self.assertTrue(commercial_code_flag('CD2.2'))
        self.assertFalse(commercial_code_flag('HCD2.2'))
        self.assertFalse(commercial_code_flag('RD1.3'))

    def test_source_ids_crs_and_truncation_fail_closed(self):
        good={'spatialReference':{'wkid':4326},'features':[{'attributes':{'OBJECTID':1}}]}
        self.assertEqual(len(validate_page(good,[1],'OBJECTID')),1)
        for change in [{'exceededTransferLimit':True},{'spatialReference':{'wkid':26917}},{'features':[]}]:
            with self.assertRaises(ValueError):validate_page({**good,**change},[1],'OBJECTID')
        with self.assertRaises(ValueError):validate_page({**good,'features':good['features']*2},[1],'OBJECTID')

    def test_holes_and_separate_islands_preserved(self):
        geom=esri_shape({'rings':[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[2,1],[2,2],[1,2],[1,1]],[[5,5],[6,5],[6,6],[5,6],[5,5]]]})
        self.assertFalse(geom.covers(Point(1.5,1.5)))
        self.assertTrue(geom.covers(Point(5.5,5.5)))
        self.assertEqual(geom.area,16)

    def test_invalid_source_geometry_held_not_repaired(self):
        with self.assertRaises(ValueError):esri_shape({'rings':[[[0,0],[1,1],[1,0],[0,1],[0,0]]]})
        with self.assertRaises(ValueError):esri_shape({'x':999,'y':0})

    def test_grid_covers_all_boundary_including_disconnected_piece(self):
        boundary=unary_union([box(-.011,.001,.012,.019),box(.02,.02,.025,.025)])
        cells=grid(boundary)
        self.assertLess(unary_union([c['geometry'] for c in cells]).symmetric_difference(boundary).area,1e-14)
        self.assertTrue(all(c['geometry'].difference(boundary).area==0 for c in cells))

    def test_multiple_buildings_not_arbitrarily_merged(self):
        geoms=[box(0,0,2,2),box(1,1,3,3)]
        self.assertEqual(covering(Point(1.5,1.5),geoms,STRtree(geoms)),[0,1])
        self.assertEqual(covering(Point(5,5),geoms,STRtree(geoms)),[])
