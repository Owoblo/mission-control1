import fs from 'node:fs/promises';
// Apply the complete ordered policy set; replaying only the original function
// would remove the reviewed-handoff checks installed by later migrations.
const migrations=['20260916000100_partnership_channel_policy.sql','20260916000200_partnership_scheduled_touch_direction.sql','20260916000300_reviewed_partnership_handoffs.sql','20260916000400_preserve_explicit_partner_link.sql'];
const sql=(await Promise.all(migrations.map(name=>fs.readFile('supabase/migrations/'+name,'utf8')))).join('\n');
const apply=process.argv.includes('--apply');
const tests=(await Promise.all(['database-policy.sql','reviewed-handoffs.sql','explicit-partner-link.sql'].map(name=>fs.readFile('tests/partnership-core/'+name,'utf8')))).join('\n');
const query=apply?`begin; ${sql} commit;`:`begin; ${sql} ${tests} rollback;`;
const r=await fetch('https://api.supabase.com/v1/projects/idbyrtwdeeruiutoukct/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
if(!r.ok)throw Error('Migration failed '+r.status+' '+await r.text());console.log(JSON.stringify({applied:apply,validated:true,result:await r.json()}));
