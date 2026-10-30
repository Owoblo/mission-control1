const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const threadExports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/partnership-email-thread-match.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:threadExports});
function fixture(options={}) {
 const contact={id:'contact-1',email:'owner@example.com',city:'Toronto',sequence_paused:true,tags:['internal-infrastructure-test'],...options.contact};
 const calls=[],sent=[],touches=new Map();let reservations=0;
 const exports={};const runtime={readEnv:()=> 'owner@example.com',requireSupabaseEnv:()=>({url:'https://db.test',headers:{}})};
 const modules={
  '@/lib/partnership-email-thread-match':threadExports,
  'next/server':{NextResponse:{json:(body,init)=>({status:init?.status||200,body})}},
  '@/lib/server/request-session':{getRequestSessionUser:async()=>options.session===null?null:options.session||{role:'owner',name:'Owner'}},
  '@/lib/server/partnership-access':{partnershipRecordMatchesSession:()=>options.scope!==false},
  '@/lib/server/runtime':runtime,'@/lib/server/saturn-send-gate':{hasUnresolvedTemplateVariable:()=>false},
  '@/lib/partnership-core/ottawa.mjs':{isOttawa:()=>false},
  '@/lib/partnership-core/reserve.mjs':{reserveAction:async()=>{reservations++;if(options.policyError)throw Error('Policy hold')}},
  '@/lib/server/email-provider':{sendProviderEmail:async p=>{sent.push(p);if(options.sendError)throw Error('Outcome unknown');return {accepted:true,messageId:'ses-123',provider:'ses'}}},
 };
 const fetch=async(url,init)=>{
  const u=new URL(url),table=u.pathname.split('/').pop(),method=init.method,body=init.body?JSON.parse(init.body):undefined;calls.push({table,method,body});
  if(options.patchError&&method==='PATCH')return {ok:false,status:503};
  let result=[];
  if(table==='market_contacts'&&method==='GET')result=[contact];
  if(table==='email_sender_accounts')result=[{from_name:'John',reply_to_email:'business@starmovers.ca'}];
  if(table==='market_touches'){
   if(method==='POST'){if(touches.has(body.id))return {ok:false,status:409};touches.set(body.id,body);result=[body]}
   else if(method==='PATCH'){const id=u.searchParams.get('id').slice(3);touches.set(id,{...touches.get(id),...body})}
   else if(u.searchParams.has('direction'))result=u.searchParams.get('direction')==='eq.inbound'?(options.inbound?[options.inbound]:[]):(options.outbounds || (options.outbound?[options.outbound]:[]));
   else{const prior=touches.get(u.searchParams.get('id').slice(3));result=prior?[prior]:[]}
  }
  return {ok:true,status:200,json:async()=>result};
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/marketing/contacts/[id]/send-email/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>modules[n]||require(n),fetch,URLSearchParams,AbortSignal,console:{error:()=>{}},Date});
 return {sent,calls,touches,get reservations(){return reservations},run:(overrides={})=>exports.POST({json:async()=>({sender:'john',subject:'Infrastructure test',body:'Test only',internalTest:true,...overrides})},{params:Promise.resolve({id:'contact-1'})})};
}
test('authentication and market scope prevent sends',async()=>{for(const opts of [{session:null},{session:{role:'crew'}},{scope:false}]){const f=fixture(opts);assert.ok((await f.run()).status>=400);assert.equal(f.sent.length,0)}});
test('internal tests require owner, exact allowlist, test tag and paused contact',async()=>{for(const opts of [{session:{role:'manager'}},{contact:{email:'prospect@example.com'}},{contact:{tags:[]}},{contact:{sequence_paused:false}}]){const f=fixture(opts);assert.equal((await f.run()).status,403);assert.equal(f.sent.length,0)}});
test('suppressed test contact cannot send',async()=>{const f=fixture({contact:{do_not_contact:true}});assert.equal((await f.run()).status,409);assert.equal(f.sent.length,0)});
test('malformed sender and header injection rejected',async()=>{for(const p of [{sender:'__proto__'},{subject:'Hi\nBcc: other@test.ca'},{body:2},{internalTest:'true'}]){const f=fixture();assert.equal((await f.run(p)).status,400);assert.equal(f.sent.length,0)}});
test('internal message recorded once and repeated request does not resend',async()=>{const f=fixture();assert.equal((await f.run()).status,200);assert.equal((await f.run()).body.alreadySent,true);assert.equal(f.sent.length,1);assert.equal(f.sent[0].purpose,'internal');assert.equal(f.sent[0].replyTo,'business@starmovers.ca');assert.equal(f.reservations,0);assert.ok(f.calls.some(c=>c.table==='sequence_jobs'&&c.body?.status==='cancelled'))});
test('reply preserves previous sender and internet message ID',async()=>{const f=fixture({inbound:{id:'reply-1',metadata:{internet_message_id:'<gmail-message@test>'}},outbound:{metadata:{from:'John <johnny@saturnstarmovers.ca>'}}});assert.equal((await f.run({sender:undefined})).status,200);assert.match(f.sent[0].from,/johnny@/);assert.equal(f.sent[0].headers['In-Reply-To'],'<gmail-message@test>')});
test('uncertain provider outcome blocks retries',async()=>{const f=fixture({sendError:true});assert.equal((await f.run()).status,409);assert.equal((await f.run()).status,409);assert.equal(f.sent.length,1)});
test('accepted send with failed CRM write reports reconciliation, not safe retry',async()=>{const f=fixture({patchError:true});const r=await f.run();assert.equal(r.status,202);assert.equal(r.body.reconciliationRequired,true);await f.run();assert.equal(f.sent.length,1)});
test('normal recipients require policy authorization and outreach ledger purpose',async()=>{const f=fixture({contact:{tags:[]}});assert.equal((await f.run({internalTest:false})).status,200);assert.equal(f.reservations,1);assert.equal(f.sent[0].purpose,'outreach');assert.ok(f.sent[0].context.policyActionKey);const blocked=fixture({contact:{tags:[]},policyError:true});assert.equal((await blocked.run({internalTest:false})).status,409);assert.equal(blocked.sent.length,0)});
test('test contact cannot enter normal outreach mode',async()=>{const f=fixture();assert.equal((await f.run({internalTest:false})).status,409);assert.equal(f.sent.length,0)});

test('multiple sending identities require explicit selection',async()=>{const f=fixture({outbounds:[{metadata:{from:'john@saturnstarmovers.ca'}},{metadata:{from:'jhon@saturnstarmovers.ca'}}]});assert.equal((await f.run({sender:undefined})).status,400);assert.equal(f.sent.length,0)});

test('Zoho normalized message IDs receive RFC brackets when replying',async()=>{const f=fixture({inbound:{id:'reply-zoho',metadata:{internet_message_id:'actual-message@mail.gmail.com'}}});assert.equal((await f.run()).status,200);assert.equal(f.sent[0].headers['In-Reply-To'],'<actual-message@mail.gmail.com>');assert.equal(f.sent[0].headers.References,'<actual-message@mail.gmail.com>')});
