import {createHash} from 'node:crypto';

// Reviews are loaded from service-only policy events, never request-body flags.
export function validSignalReview(event, action, now=Date.now()) {
 const e=event?.evidence;
 if(event?.event_type!=='signal_introduction.reviewed'||!e) return false;
 const reviewed=Date.parse(event.occurred_at), expires=Date.parse(e.expires_at);
 return event.action_key===action.key && event.account_id===action.accountId &&
  e.contact_id===action.contactId && e.channel==='email' && action.channel==='email' &&
  e.recipient===action.recipient && e.sender===action.sender &&
  e.content_hash===createHash('sha256').update(action.content||'').digest('hex') &&
  typeof e.reviewed_by==='string' && e.reviewed_by.trim().length>0 &&
  typeof e.source_url==='string' && e.source_url.startsWith('https://') &&
  Number.isFinite(reviewed) && reviewed<=now && Number.isFinite(expires) &&
  expires>now && expires<=reviewed+86400000 && Array.isArray(e.reviewed_tasks);
}
