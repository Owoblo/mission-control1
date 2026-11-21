import json
import unittest
from scripts.market_map.windsor_school_batch import parse


class SchoolBatchTests(unittest.TestCase):
    def part(self, sid, name):
        return "<strong><a data-value='"+sid+"'>"+name+"</a></strong><br/>284 Cameron, Windsor, Ontario, Canada N9B 1Y6<br/>Directions: <a href='http://maps.google.com/?daddr=42.3135912,-83.0541763'>To Here</a>"

    def test_colocated_programs_remain_distinct(self):
        body='_infoWindow.setContent('+json.dumps(self.part('a','School A')+self.part('b','Program B'))+');'
        records=parse(body)
        self.assertEqual(len(records),2)
        self.assertEqual(records[0]['full_address'],records[1]['full_address'])
        self.assertNotEqual(records[0]['source_record_id'],records[1]['source_record_id'])

    def test_schema_failure_not_silent_zero(self):
        with self.assertRaises(ValueError):parse('<html>Blocked</html>')
        with self.assertRaises(ValueError):parse('_infoWindow.setContent("schema changed");')

    def test_conflicting_id_held(self):
        body='_infoWindow.setContent('+json.dumps(self.part('a','School A')+self.part('a','School B'))+');'
        with self.assertRaises(ValueError):parse(body)


if __name__=='__main__':unittest.main()
