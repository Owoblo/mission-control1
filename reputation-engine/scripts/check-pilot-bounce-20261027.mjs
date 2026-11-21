import './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261015.mjs');
const id='010f01a17f8a25a7-7e7f8903-0942-4b3b-a4ab-76c2e4329dde-000000';
const events=await db('email_provider_events',{provider_message_id:'eq.'+id,event_type:'eq.email_bounced'});
const dispatch=await db('prepared_email_dispatches',{message_id:'eq.'+id});
const contacts=await db('market_contacts',{id:'eq.'+dispatch[0].contact_id,select:'id,company,email,email_status,email_unsubscribed_at'});
const suppression=await db('crm_email_suppressions',{recipient:'eq.'+contacts[0].email});
console.log(JSON.stringify({events:events.map(e=>({eventType:e.event_type,occurredAt:e.occurred_at,bounce:JSON.parse(e.payload.Message).bounce})),contacts,suppression},null,2));
