import unittest
from .relationship_segmentation import recommend_channel

class ChannelTests(unittest.TestCase):
    def test_mobile_verification_alone_does_not_prove_recipient_identity(self):
        r = recommend_channel({'mobile_verified': True, 'sms_capable': True, 'vertical': 'realtor'})
        self.assertIsNone(r['recommended_channel'])

    def test_personal_email_preference_overrides_realtor_default(self):
        r = recommend_channel({'mobile_verified': True, 'sms_capable': True, 'route_identity_verified': True,
                               'professional_email_verified': True, 'vertical': 'realtor',
                               'explicit_preferred_channel': 'email', 'preference_evidence': 'inbound message'})
        self.assertEqual(r['recommended_channel'], 'email')
        self.assertEqual(r['preference_state'], 'explicit')

    def test_unavailable_preferred_route_does_not_silently_switch_channels(self):
        r = recommend_channel({'mobile_verified': True, 'sms_capable': True, 'route_identity_verified': True,
                               'explicit_preferred_channel': 'email', 'preference_evidence': 'inbound message'})
        self.assertIsNone(r['recommended_channel'])
        self.assertEqual(r['basis'], 'preferred_route_requires_review')

    def test_finance_and_realtor_defaults_are_hypotheses_not_preferences(self):
        routes = {'mobile_verified': True, 'sms_capable': True, 'route_identity_verified': True, 'professional_email_verified': True}
        self.assertEqual(recommend_channel({**routes, 'contact_role': 'CFO'})['recommended_channel'], 'email')
        r = recommend_channel({**routes, 'vertical': 'realtor'})
        self.assertEqual(r['recommended_channel'], 'sms')
        self.assertEqual(r['preference_state'], 'not_personally_confirmed')
        self.assertFalse(r['send_authorized'])

    def test_existing_thread_and_suppression_override_defaults(self):
        routes = {'professional_email_verified': True, 'active_conversation_channel': 'email', 'conversation_evidence': 'thread'}
        self.assertEqual(recommend_channel(routes)['basis'], 'existing_conversation')
        self.assertIsNone(recommend_channel({**routes, 'suppressed': True})['recommended_channel'])

    def test_both_channels_still_selects_one_action(self):
        r = recommend_channel({'mobile_verified': True, 'sms_capable': True, 'route_identity_verified': True,
                               'professional_email_verified': True, 'explicit_preferred_channel': 'both',
                               'preference_evidence': 'inbound', 'active_conversation_channel': 'sms'})
        self.assertEqual(r['recommended_channel'], 'sms')
        self.assertFalse(r['simultaneous_send'])
        self.assertFalse(r['send_authorized'])

if __name__ == '__main__': unittest.main()
