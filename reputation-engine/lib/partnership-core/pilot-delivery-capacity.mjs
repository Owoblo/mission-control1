/** A bounced attempt releases a slot; pending/ambiguous acceptances retain one. */
export function pilotDeliveryCapacity({target=3000,dispatches=[],events=[]}){
 if(!Number.isSafeInteger(target)||target<1)throw Error('Invalid delivery target');
 const adverse=new Set(events.filter(e=>['email_bounced','email_complained','email_rejected'].includes(e.event_type)).map(e=>e.provider_message_id));
 const deliveredIds=new Set(events.filter(e=>e.event_type==='email_delivered'&&!adverse.has(e.provider_message_id)).map(e=>e.provider_message_id));
 const committed=new Set(),delivered=new Set();
 for(const d of dispatches){
  const recipient=String(d.recipient||'').trim().toLowerCase();
  if(!recipient)throw Error('Dispatch recipient required for capacity');
  if(d.message_id&&adverse.has(d.message_id))continue;
  if(d.message_id&&deliveredIds.has(d.message_id)){delivered.add(recipient);committed.add(recipient);}
  else if(['accepted','ambiguous','dispatching'].includes(d.state))committed.add(recipient);
 }
 return {target,distinctDelivered:delivered.size,committedRecipients:committed.size,availableInitialSlots:Math.max(0,target-committed.size)};
}
