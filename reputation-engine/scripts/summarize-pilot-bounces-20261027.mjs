import {db,fs} from './gta-email-recovery-runtime.mjs';
const status=JSON.parse(fs.readFileSync('artifacts/partnership-pilot-3000-20261027/live-pilot-status.json'));
const ids=[...new Set(status.events.filter(e=>e.event_type==='email_bounced').map(e=>e.provider_message_id))];
const rows=ids.length?await db('email_provider_events',{provider_message_id:'in.('+ids.join(',')+')',event_type:'eq.email_bounced',select:'provider_message_id,payload'}):[];
const groups={};for(const e of rows){const m=typeof e.payload.Message==='string'?JSON.parse(e.payload.Message):e.payload;const b=m.bounce||{};const key=(b.bounceType||'unknown')+'/'+(b.bounceSubType||'unknown');groups[key]=(groups[key]||0)+1;}
console.log(JSON.stringify({snapshot:status.at,accepted:status.providerAccepted,bounces:ids.length,groups},null,2));
