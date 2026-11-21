// Full metadata coverage; read full bodies only for relevant/changed contacts.
export function reviewIndex(rows,contacts,now,previous=null){
 const latest=new Map(),sent=new Map(),historical=new Set(),oldIDs=new Set(previous?.items?.map(x=>x.id)||[]);
 const previousCutoff=Date.parse(previous?.cutoff||'');
 for(const row of rows){
  if(!latest.has(row.contact_id)||Date.parse(latest.get(row.contact_id).created_at)<Date.parse(row.created_at))latest.set(row.contact_id,row);
  if(row.direction==='outbound'&&(!sent.has(row.contact_id)||Date.parse(sent.get(row.contact_id).created_at)<Date.parse(row.created_at)))sent.set(row.contact_id,row);
  if(previous&&oldIDs.size&&!oldIDs.has(row.id)&&Date.parse(row.created_at)<previousCutoff-2*3600000)historical.add(row.contact_id);
 }
 const due=[];
 for(const c of contacts){
  const last=sent.get(c.id);if(!last||c.do_not_contact||c.cross_channel_suppressed_at||['opted_out','rejected','bad_number'].includes(c.decision)||['dnc','closed_lost'].includes(c.stage)||/internal .*test/i.test(c.name||''))continue;
  const days=(now-Date.parse(last.created_at))/86400000;if(days<30)continue;
  const dateAfter=n=>new Date(Date.parse(last.created_at)+n*86400000).toISOString();
  due.push({contact_id:c.id,name:c.name,city:c.city,last_outbound_id:last.id,last_outbound_at:last.created_at,last_indexed_touch_id:latest.get(c.id)?.id,last_indexed_touch_at:latest.get(c.id)?.created_at,days_since_outbound:Math.floor(days),review_band:days>=60?'normal_60_day_review':days>=45?'45_day_context_or_signal_review':'30_day_early_review',early_review_at:dateAfter(30),context_review_at:dateAfter(45),normal_reminder_review_at:dateAfter(60),holds:['full_history_preferences_promises_and_route_scope_review','no_automatic_nurture_send'],send_ready:false});
 }
 return {latest:[...latest.values()],due_inventory:due,historical_import_contact_ids:[...historical],indexed_records:rows.length,indexed_contacts:latest.size};
}
