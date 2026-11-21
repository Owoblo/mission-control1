import fs from 'node:fs/promises';
const id='e83bc450-6a4e-4a63-8f75-2168d982aa61';
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
const base=process.env.SUPABASE_URL+'/rest/v1/';
const r=await fetch(base+'market_touches?'+new URLSearchParams({contact_id:'eq.'+id,direction:'eq.inbound',select:'id,notes'}),{headers});if(!r.ok)throw Error('Evidence lookup failed');
const evidence=(await r.json()).find(t=>t.notes?.includes('Please take me off your call list.'));if(!evidence)throw Error('Missing exact unsubscribe evidence');
const patch=await fetch(base+'market_contacts?id=eq.'+id,{method:'PATCH',headers,body:JSON.stringify({do_not_contact:true,stage:'dnc',sequence_paused:true,sequence_paused_reason:'Explicit request to leave call list; retired and moved. Source touch '+evidence.id,next_follow_up:null})});if(!patch.ok)throw Error('Suppression write failed');
await fs.writeFile('partnership-system/markets/ca/on/ottawa/barb-unsubscribe-repair.json',JSON.stringify({contactId:id,sourceTouch:evidence.id,at:new Date().toISOString(),do_not_contact:true},null,2));console.log('Barb Taylor: explicit unsubscribe preserved as DNC; no outreach sent');
