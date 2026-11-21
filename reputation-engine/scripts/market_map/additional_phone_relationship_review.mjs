// Reuse account matching only. Additional website phones have no carrier proof.
import {reviewMobile} from './mobile_relationship_review.mjs';
export function reviewAdditionalPhones(report, contacts, companies, sales, now=new Date()) {
 const age=now-new Date(report.summary?.checked_at);
 if(!Number.isFinite(age)||age< -60000||age>900000)return {summary:{state:'source_review_stale',send_ready:0,messages_sent:0,owner_send_hold:true},rows:[]};
 const fresh=value=>{const age=now-new Date(value);return Number.isFinite(age)&&age>=-60000&&age<=86400000};
 const rows=report.rows.filter(r=>r.state==='source_association_passed_carrier_and_crm_pending'&&r.matches?.length&&r.matches.every(m=>fresh(m.captured_at))).map(r=>{
  const account=reviewMobile(r,contacts,companies,sales,now);
  const holds=new Set([...r.release_holds,'country_and_line_type_review','fresh_source_and_channel_check_before_release','category_message_approval_required','owner_send_hold']);
  if(account.crm_match_found)holds.add('existing_relationship_review');
  if(account.release_holds.includes('possible_suppressed_relationship'))holds.add('possible_suppressed_relationship');
  return {...r,contacts:account.contacts,companies:account.companies,sales:account.sales,crm_match_found:account.crm_match_found,
   crm_checked_at:now.toISOString(),carrier_checked:false,send_ready:false,owner_send_hold:true,release_holds:[...holds]};
 });
 return {summary:{state:'reviewed_pending_carrier',checked_at:now.toISOString(),source_checked_at:report.summary.checked_at,
  additional_routes_reviewed:rows.length,existing_relationship_matches:rows.filter(r=>r.crm_match_found).length,
  possible_suppressed_relationships:rows.filter(r=>r.release_holds.includes('possible_suppressed_relationship')).length,
  no_current_crm_match:rows.filter(r=>!r.crm_match_found).length,carrier_calls:0,crm_writes:0,verified_unique_contacts:0,
  send_ready:0,messages_sent:0,owner_send_hold:true},rows};
}
