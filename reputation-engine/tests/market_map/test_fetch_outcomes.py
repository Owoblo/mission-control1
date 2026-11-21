import socket,unittest,urllib.error
from unittest.mock import patch
from datetime import datetime,timezone
from scripts.market_map.transport import Transport,SourceBlocked,BudgetExceeded,Response
from scripts.market_map.fetch_outcomes import retry_after
PUBLIC=[(socket.AF_INET,socket.SOCK_STREAM,6,'',('8.8.8.8',443))]
class FetchOutcomeTests(unittest.TestCase):
 def test_retry_after_at_zero_retries_and_no_extra_requests(self):
  for code in [429,503]:
   t=Transport(retries=0,min_interval=0,allowed_hosts={'business.test'})
   with patch('socket.getaddrinfo',return_value=PUBLIC),patch.object(t.opener,'open',side_effect=urllib.error.HTTPError('https://business.test',code,'busy',{'Retry-After':'86400'},None)) as op:
    with self.assertRaises(SourceBlocked) as caught:t.fetch('https://business.test',robots=False)
    self.assertEqual(caught.exception.code,'http_temporary');self.assertTrue(caught.exception.retryable);self.assertTrue(caught.exception.retry_after_at);self.assertEqual(op.call_count,1)
 def test_dates_invalid_headers_and_legacy_exception_api(self):
  at=datetime(2026,1,1,tzinfo=timezone.utc)
  self.assertEqual(retry_after('60',at),'2026-01-01T00:01:00+00:00')
  self.assertEqual(retry_after('Fri, 02 Jan 2026 00:00:00 GMT',at),'2026-01-02T00:00:00+00:00')
  self.assertIsNone(retry_after('garbage',at));self.assertIsInstance(SourceBlocked('old'),RuntimeError);self.assertFalse(SourceBlocked('old').retryable)
 def test_robots_failure_remains_policy_hold(self):
  t=Transport(retries=0)
  with patch.object(t,'_request',side_effect=SourceBlocked('busy',code='http_temporary',retryable=True,http_status=503)):
   with self.assertRaises(SourceBlocked) as caught:t._check_robots('https://business.test/a',{'business.test'})
  self.assertEqual(caught.exception.code,'robots_unresolved');self.assertFalse(caught.exception.retryable)
 def test_dns_and_timeout_classification(self):
  t=Transport(retries=0,min_interval=0,allowed_hosts={'business.test'})
  with patch('socket.getaddrinfo',side_effect=socket.gaierror(socket.EAI_AGAIN,'temporary')):
   with self.assertRaises(SourceBlocked) as caught:t.fetch('https://business.test')
  self.assertEqual(caught.exception.code,'dns_transient')
  with patch('socket.getaddrinfo',return_value=PUBLIC),patch.object(t.opener,'open',side_effect=TimeoutError()):
   with self.assertRaises(SourceBlocked) as caught:t.fetch('https://business.test',robots=False)
  self.assertEqual(caught.exception.code,'timeout');self.assertTrue(caught.exception.retryable)
 def test_protocol_failure_does_not_add_in_call_retries(self):
  from http.client import BadStatusLine
  t=Transport(retries=2,min_interval=0,allowed_hosts={'business.test'})
  with patch('socket.getaddrinfo',return_value=PUBLIC),patch.object(t.opener,'open',side_effect=BadStatusLine('bad')) as op,patch('time.sleep') as sleep:
   with self.assertRaises(SourceBlocked) as caught:t.fetch('https://business.test',robots=False)
   self.assertEqual(caught.exception.code,'network_failure');self.assertEqual(op.call_count,1);sleep.assert_not_called()
