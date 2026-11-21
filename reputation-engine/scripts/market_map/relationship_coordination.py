"""One action per relationship; signals enrich evidence without granting send rights."""
from datetime import timedelta
try:
 from .prepared_relationship_buffer import dt,digest
except ImportError:
 from prepared_relationship_buffer import dt,digest

def coordinate(action,record,signals,now):
 history=(record or{}).get('history',[]);meaningful=[t for t in history if t.get('direction')in ('inbound','outbound')and not str(t.get('notes','')).startswith('SES event:')]
 last_out=max((dt(t['created_at'])for t in meaningful if t['direction']=='outbound'),default=None);last_any=max((dt(t['created_at'])for t in meaningful),default=None)
 fresh=[];held=[];seen=set()
 for signal in signals:
  key=signal.get('canonical_event_key')or(str(signal.get('source'))+':'+str(signal.get('event_id')))
  if key in seen:continue
  seen.add(key)
  try:
   published=dt(signal['published_at']);expiry=dt(signal['expires_at']);valid=signal.get('identity_verified')is True and signal.get('source')and signal.get('event_id')and published<=now and expiry>now
  except (KeyError,ValueError,TypeError):valid=False
  (fresh if valid else held).append(signal)
 direct=action['kind']in ('requested_card_fulfilment','requested_email_fulfilment','specific_request_context_review','context_review','call_context_review','sales_history_review','owner_exception','owner_meeting_review','owner_terms_or_reference_review')
 pending=bool((action.get('checks')or{}).get('pending_jobs'))
 recent=bool(last_any and now-last_any<timedelta(days=7))
 action['coordination']={'one_primary_action':True,'fresh_signal_evidence':fresh,'held_signal_evidence':held,'signals_create_additional_message':False,'recent_engagement':recent,'last_outbound_at':last_out.isoformat()if last_out else None,'early_review_at':(last_out+timedelta(days=30)).isoformat()if last_out else None,'context_review_at':(last_out+timedelta(days=45)).isoformat()if last_out else None,'normal_reminder_review_at':(last_out+timedelta(days=60)).isoformat()if last_out else None,'priority_rule':'existing_request_or_commitment_first'if direct else 'quiet_relationship_review'}
 if fresh and(direct or recent or pending):action['coordination']['signal_action']='evidence_only_existing_conversation_or_reservation'
 elif fresh:action['coordination']['signal_action']='review_one_existing_plan_not_an_extra_touch'
 else:action['coordination']['signal_action']='no_verified_fresh_signal'
 if not direct and action['kind']=='quiet_relationship_review'and last_out:
  threshold=last_out+timedelta(days=45 if fresh else 60)
  if dt(action['not_before'])<threshold:action['not_before']=threshold.isoformat()
 action['source_fingerprint']=digest({'base':action['source_fingerprint'],'signals':sorted(seen)})
 return action
