import './gta-email-recovery-runtime.mjs';import {db} from './reply-runtime-20261015.mjs';
const r=await db('subcontractors',{id:'eq.772266aa-1c5b-4171-8b39-a68e7ce5f3be'});console.log(JSON.stringify(r.map(c=>({id:c.id,company:c.company_name,name:c.contact_name,phone:c.phone,status:c.status,city:c.service_cities})),null,2));
const e=await db('email_provider_events',{created_at:'gte.2026-10-17T18:10:00Z',limit:100});console.log(JSON.stringify(e.map(x=>({type:x.event_type,at:x.created_at,subject:x.payload?.mail?.commonHeaders?.subject,to:x.payload?.mail?.destination})),null,2));
