// Deterministic decisions only: no model output, network calls or mutations.
export const POLICY_VERSION='partnership-policy-v1';
export function evaluateHistory(action,contacts=[]){
 const reasons=[];
 if(contacts.some(c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)||['dnc','closed_lost','do_not_contact'].includes(c.stage)||['opted_out','rejected'].includes(c.decision)))reasons.push('suppressed_or_restricted');
 if(action.kind==='cold_introduction'&&contacts.some(c=>c.last_inbound_at||c.last_touch_at))reasons.push('existing_account_conversation');
 return {allowed:reasons.length===0,reasons,policyVersion:POLICY_VERSION,coverage:'account_history_only'};
}
export function evaluate(action,state,now=Date.now()){
 const reasons=[];
 if(!['email','sms','phone','direct_mail'].includes(action.channel))reasons.push('unsupported_channel');
 if(!['cold_introduction','reply','fulfil_promise','referred_introduction'].includes(action.kind))reasons.push('unsupported_action');
 if(!Number.isFinite(now))reasons.push('invalid_clock');
 const captured=Date.parse(state.observedAt);
 if(!Number.isFinite(captured)||captured>now||now-captured>5*60*1000)reasons.push('stale_policy_snapshot');
 for(const k of ['historyComplete','marketActive','serviceAvailable','channelEligible','senderHealthy'])if(state[k]!==true)reasons.push(k+'_not_confirmed');
 if(state.accountId!==action.accountId||!action.accountId)reasons.push('account_mismatch');
 if(state.suppressed!==false)reasons.push('suppressed_or_unknown');
 if(state.notBefore===undefined)reasons.push('timing_unknown');
 else if(state.notBefore!==null&&(!Number.isFinite(Date.parse(state.notBefore))||Date.parse(state.notBefore)>now))reasons.push('requested_wait');
 if(action.kind==='cold_introduction'){
  if(state.humanReply!==false)reasons.push('account_reply_or_unknown');
  if(state.pendingReferral!==false)reasons.push('referral_pending_or_unknown');
  if(state.unresolvedPromise!==false)reasons.push('promise_pending_or_unknown');
  if(!Number.isInteger(state.newRecipientsThisWeek)||state.newRecipientsThisWeek<0||state.newRecipientsThisWeek>=2)reasons.push('account_weekly_limit_or_unknown');
 }
 return {allowed:reasons.length===0,reasons,policyVersion:POLICY_VERSION,coverage:'full_required_facts',actionId:action.id};
}
