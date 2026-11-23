import unittest

from .partnership_advocacy import tier

CONTACT = {'id':'partner','name':'Partner','category':'realtor','city':'Windsor'}
REF = {'contact_id':'partner','job_id':'job','crm_lead_id':'lead','job_status':'completed'}
LEAD = {'contact_id':'partner','id':'lead','stage':'completed'}


def feedback(alias, side):
    return {'related_id':'partner','title':'Feedback','status':'completed',
            'source_key':f'partner-referral-feedback:{alias}:{side}','outcome_note':'Positive: confirmed in CRM thread'}


class AdvocacyTests(unittest.TestCase):
    def test_completion_requires_both_sides_and_dedupes_aliases(self):
        refs=[REF,{**REF,'job_id':None}]
        self.assertEqual(tier(CONTACT,refs,[LEAD],[])['state'],'Completed referral · feedback needed')
        record=tier(CONTACT,refs,[LEAD],[feedback('job','partner'),feedback('lead','customer')])
        self.assertEqual(record['completed_jobs'],1)
        self.assertEqual(record['state'],'Verified advocate')
        self.assertEqual(record['permissions'],[])

    def test_holds_take_precedence_and_feedback_does_not_cross_jobs(self):
        two=[REF,{'contact_id':'partner','job_id':'other','crm_lead_id':None,'job_status':'completed'}]
        feedback_rows=[feedback('job','partner'),feedback('other','customer')]
        self.assertEqual(tier(CONTACT,two,[LEAD],feedback_rows)['state'],'Completed referral · feedback needed')
        tasks=[feedback('job','partner'),feedback('lead','customer'),
               {'related_id':'partner','title':'Open refund review','status':'open'}]
        self.assertEqual(tier(CONTACT,two,[LEAD],tasks)['state'],'Service recovery')
