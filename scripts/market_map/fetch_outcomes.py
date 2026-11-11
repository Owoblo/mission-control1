"""Stable failure metadata. Unknown failures are review-only, never bypass signals."""
from datetime import datetime,timezone,timedelta
from email.utils import parsedate_to_datetime


def retry_after(value,now=None):
    now=now or datetime.now(timezone.utc)
    try:
        if str(value).isdigit():return (now+timedelta(seconds=int(value))).isoformat()
        at=parsedate_to_datetime(value)
        if at.tzinfo is None:at=at.replace(tzinfo=timezone.utc)
        return max(now,at).isoformat()
    except (ValueError,TypeError,OverflowError,IndexError):return None


class FetchFailure(RuntimeError):
    def __init__(self,message,*,code='unknown_review',http_status=None,url=None,retryable=False,retry_after_at=None,budget_reason=None,policy_scope='url'):
        super().__init__(message)
        self.code,self.http_status,self.url=code,http_status,url
        self.retryable,self.retry_after_at,self.budget_reason,self.policy_scope=retryable,retry_after_at,budget_reason,policy_scope
    def as_dict(self):
        return {k:getattr(self,k) for k in ('code','http_status','url','retryable','retry_after_at','budget_reason','policy_scope')}|{'message':str(self)}


def outcome(error,url=None,*,phase='fetch'):
    if isinstance(error,FetchFailure):return {**error.as_dict(),'url':error.url or url}
    return {'code':'parse_error' if phase=='parse' else 'unknown_review','url':url,'retryable':False,
            'http_status':None,'retry_after_at':None,'budget_reason':None,'policy_scope':'url','message':str(error)[:500]}
