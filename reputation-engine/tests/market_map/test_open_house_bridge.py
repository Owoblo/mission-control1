import datetime as dt
import tempfile
import unittest
from pathlib import Path
from scripts.research_hub.open_house_bridge import compile_activity


class BridgeTest(unittest.TestCase):
    def test_replay_conflicts_and_expiry_do_not_link_or_send(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder,'detail.json').write_text('Captured public evidence')
            row=dict(current_detail_signal=True,mls='X123',address='1 Main, Windsor, Ontario',
                detail_url='https://www.realtor.ca/real-estate/123/example',evidence_file='detail.json',
                observed_at='2026-11-17T00:00:00Z',open_house_events=[{'date':'2026-11-22','year_basis':'year not explicit'}],
                associated_agents=[dict(name='Alice',direct_phone_displayed='519-555-1234',role='Salesperson')])
            contacts=[dict(id='bob',name='Bob',phone='+15195551234')]
            result=compile_activity({'rows':[row,row]},contacts,folder,dt.date(2026,11,17))
            self.assertEqual(result['summary']['agent_associations'],1)
            self.assertEqual(result['summary']['identity_conflicts'],1)
            self.assertIsNone(result['rows'][0]['contact_id'])
            self.assertFalse(result['rows'][0]['representative']['outreach_eligible'])
            self.assertTrue(result['rows'][0]['representative']['schedule_year_requires_confirmation'])
            expired=compile_activity({'rows':[row]},contacts,folder,dt.date(2026,11,23))
            self.assertEqual(expired['rows'],[])
            self.assertEqual(expired['holds'][0]['reason'],'schedule_expired')


if __name__=='__main__':
    unittest.main()
