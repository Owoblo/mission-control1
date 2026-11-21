export function deliveryExposure(jobs, events, target=1500) {
 const byProvider=new Map()
 for(const e of events){if(e.event_type!=='message.finalized')continue;const id=e.provider_message_id;const prev=byProvider.get(id);if(prev?.status==='delivered')continue;if(!prev||e.status==='delivered'||Date.parse(e.occurred_at)>=Date.parse(prev.occurred_at))byProvider.set(id,e)}
 let delivered=0,failed=0
 for(const j of jobs){const e=byProvider.get(String(j.provider_sid||'').replace('telnyx:',''));if(e?.status==='delivered')delivered++;else if(e?.status==='delivery_failed'&&['sent','failed'].includes(j.status))failed++}
 const unresolved=jobs.length-delivered-failed
 return {target,delivered,confirmed_failed:failed,unresolved,queued_total:jobs.length,available:Math.max(0,target-delivered-unresolved)}
}
