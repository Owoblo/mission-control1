// Local-only credential capture. No credentials are printed or stored in the playbook.
import http from 'node:http';
import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {openZohoMailbox} from '../lib/partnership-core/zoho.mjs';
const port=8817, origin=`http://127.0.0.1:${port}`, key=randomBytes(24).toString('hex');
const target='.env.zoho-ottawa.local';
const scopes='ZohoMail.accounts.READ,ZohoMail.messages.READ,ZohoMail.messages.CREATE';
const html=`<!doctype html><html><head><meta charset="utf-8"><title>Connect Dexa email</title><style>body{font:17px system-ui;max-width:750px;margin:45px auto;padding:24px;color:#152238}li{margin:14px 0}input{display:block;width:95%;padding:12px;margin:8px 0 20px}button{padding:13px 24px;background:#152238;color:white;border:0;border-radius:8px}code{overflow-wrap:anywhere}label{font-weight:600}</style></head><body><h1>Connect hello@dexamovers.ca</h1><p>This page runs only on your Mac. It adds a separate Ottawa connection; your existing Saturn mailbox stays connected.</p><ol><li>Open <a href="https://api-console.zohocloud.ca/" target="_blank" rel="noreferrer">Zoho API Console</a> and sign in as the account that owns <b>hello@dexamovers.ca</b>.</li><li>Choose <b>Self Client</b> (create it if needed). From its <b>Client Secret</b> tab, copy the Client ID and Client Secret into the fields below.</li><li>In <b>Generate Code</b>, use these scopes:<p><code>${scopes}</code></p>Choose the longest available short duration, describe it as “Dexa Ottawa partnership mail”, then generate the code.</li><li>Paste that code below and connect promptly, before it expires.</li></ol><p>Enter the client secret here, not in chat. Do not enter your Zoho password. <a href="https://www.zoho.com/developer/oauth/self-client/overview.html" target="_blank" rel="noreferrer">Zoho instructions</a></p><form method="post" action="/${key}"><label>Client ID<input name="client_id" required autocomplete="off"></label><label>Client Secret<input name="client_secret" type="password" required autocomplete="off"></label><label>Generated Code<input name="code" type="password" required autocomplete="off"></label><button>Connect Dexa mailbox</button></form></body></html>`;
let working=false;
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
 if(req.headers.host!==`127.0.0.1:${port}`||req.url!==`/${key}`){res.writeHead(404);return res.end('Not found')}
 if(req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html)}
 if(req.method!=='POST'||req.headers.origin!==origin||working){res.writeHead(403);return res.end('Request rejected')}
 working=true;
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12000)throw Error('Request too large')}
  const fields=new URLSearchParams(raw);const id=fields.get('client_id')?.trim(),secret=fields.get('client_secret')?.trim(),code=fields.get('code')?.trim();
  if(!id||!secret||!code)throw Error('Missing connection fields');
  const response=await fetch('https://accounts.zohocloud.ca/oauth/v2/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),body:new URLSearchParams({grant_type:'authorization_code',client_id:id,client_secret:secret,code})});
  const token=await response.json();if(!response.ok||!token.refresh_token)throw Error('Code exchange failed. Generate a fresh code from the Canada Zoho account and try again.');
  const env={ZOHO_OTTAWA_CLIENT_ID:id,ZOHO_OTTAWA_CLIENT_SECRET:secret,ZOHO_OTTAWA_REFRESH_TOKEN:token.refresh_token,ZOHO_OTTAWA_ACCOUNTS_URL:'https://accounts.zohocloud.ca',ZOHO_OTTAWA_MAIL_URL:'https://mail.zohocloud.ca'};
  const mailbox=await openZohoMailbox('ottawa',fetch,env);
  await fs.writeFile(target,Object.entries(env).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
  await fs.writeFile('partnership-system/markets/ca/on/ottawa/connection-status.json',JSON.stringify({mailbox:mailbox.mailbox,accountId:mailbox.accountId,localConnectionVerified:true,productionConfigured:false,at:new Date().toISOString()},null,2));
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<h1>Dexa mailbox verified</h1><p>The separate local connection is saved securely. Return to Codex so production setup and the sending test can finish.</p>');
  console.log('Dexa mailbox verified. Secure local configuration saved; production activation remains.');server.close();
 }catch(error){res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(error.code==='EEXIST'?'Connection file already exists; ask Codex to inspect it before replacing.':String(error.message));working=false}
});
server.listen(port,'127.0.0.1',()=>console.log(`Open ${origin}/${key}`));
setTimeout(()=>server.close(),45*60*1000).unref();
