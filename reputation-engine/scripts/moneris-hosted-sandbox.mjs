import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Local test harness only. No application/database imports or live endpoints.
const origin = 'http://localhost:3100'
const nonce = randomUUID()
const env = Object.fromEntries(readFileSync(new URL('../.env.moneris-saturn.local', import.meta.url), 'utf8')
  .trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))
const profile = env.SATURN_MONERIS_HOSTED_PROFILE_ID
if (!/^ht[A-Za-z0-9]+$/.test(profile || '')) throw new Error('Missing sandbox hosted profile ID')
const frame = new URL('https://esqa.moneris.com/HPPtoken/index.php')
for (const [key, value] of Object.entries({ id: profile, pmmsg: 'true', enable_exp: '1', enable_cvd: '1',
  display_labels: '1', css_body: 'background:white;font-family:Arial;margin:10px;',
  css_textbox: 'font-size:18px;padding:8px;margin:5px;border:1px solid gray;border-radius:5px;' })) frame.searchParams.set(key, value)
let busy = false
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saturn · Moneris sandbox</title><style>
body{font:17px system-ui;background:#f2f5f9;color:#142a41;margin:0;padding:40px 20px}main{max-width:760px;margin:auto;background:white;padding:32px;border-radius:18px}h1{margin-top:0}small{color:#65758a}iframe{width:100%;height:230px;border:1px solid #ccd7e4;border-radius:8px}button{background:#12647b;color:white;padding:14px 22px;border:0;border-radius:8px;font:inherit;cursor:pointer}button:disabled{opacity:.5}pre{white-space:pre-wrap;font:14px monospace;background:#f2f5f9;padding:16px}code{font-size:16px}label{display:block;margin:20px 0}
</style><main><small>SATURN · SANDBOX ONLY</small><h1>Test Saturn’s Moneris payments</h1>
<p>Use Moneris’s synthetic Visa: <code>4242424242424242</code>, expiry <code>0128</code>, security code <code>123</code>. Enter only test card details.</p>
<iframe id="card" title="Moneris secure test card entry" src="${frame.href}"></iframe>
<label>Test flow <select id="suite"><option value="payments">Deposit, saved card, balance and refund</option><option value="parity">Phone deposit and balance authorization</option><option value="vault">Save a card and charge it later</option><option value="3ds">3D Secure authentication</option></select></label>
<label><input id="consent" type="checkbox"> Run this simulation using the sandbox card.</label>
<button id="pay" disabled>Run sandbox checkout test</button><p id="status" role="status">Loading Moneris card entry…</p><pre id="results" hidden></pre>
<script>
const frame=document.getElementById('card'),button=document.getElementById('pay'),consent=document.getElementById('consent'),status=document.getElementById('status'),suite=document.getElementById('suite');
let pending=false,loaded=false,submitted=false,timer,selectedSuite;
frame.addEventListener('load',()=>{loaded=true;status.textContent='Enter the test card above, then confirm the simulation.';button.disabled=!consent.checked;});
consent.addEventListener('change',()=>button.disabled=!loaded||!consent.checked||pending||submitted);
button.addEventListener('click',()=>{pending=true;selectedSuite=suite.value;button.disabled=true;status.textContent='Tokenizing test card with Moneris…';frame.contentWindow.postMessage('tokenize','https://esqa.moneris.com');timer=setTimeout(()=>{if(!submitted){pending=false;button.disabled=!consent.checked;status.textContent='No token response received. No payment request was sent.';}},20000);});
window.addEventListener('message',async event=>{
 if(event.origin!=='https://esqa.moneris.com'||event.source!==frame.contentWindow||!pending||submitted)return;
 let value;try{value=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
 if(!value||!value.responseCode)return;
 clearTimeout(timer);
 const codes=Array.isArray(value.responseCode)?value.responseCode:[value.responseCode];
 if(!codes.every(code=>String(code)==='001')||!value.dataKey){pending=false;button.disabled=!consent.checked;status.textContent='Card entry rejected by Moneris: '+codes.join(', ');return;}
 submitted=true;status.textContent='Card token received. Running the selected sandbox checks…';
 try{const response=await fetch('/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:value.dataKey,suite:selectedSuite,nonce:${JSON.stringify(nonce)}})});const result=await response.json();
 document.getElementById('results').hidden=false;document.getElementById('results').textContent=JSON.stringify(result,null,2);
 status.textContent=result.ok?'Sandbox checkout and payment checks passed.':'Test did not complete successfully. Review the result; do not resubmit an uncertain payment.';
 }catch{status.textContent='Connection interrupted. Payment outcome needs reconciliation. Do not submit again.';}
});
</script></main></html>`

createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.headers.host !== 'localhost:3100') { res.writeHead(403); return res.end() }
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.end(html)
  }
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST' || req.url !== '/run') { res.writeHead(404); return res.end('{}') }
  if (req.headers.origin !== origin) { res.writeHead(403); return res.end('{}') }
  let body = ''
  try {
    for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('Body too large') }
    const input = JSON.parse(body)
    if (input.nonce !== nonce || typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{10,256}$/.test(input.token)) throw new Error('Invalid request')
    if (!['payments', 'parity', 'vault', '3ds'].includes(input.suite)) throw new Error('Invalid test flow')
    if (busy) { res.writeHead(409); return res.end(JSON.stringify({ ok: false, error: 'A sandbox run is already active' })) }
    busy = true
    const child = spawn(process.execPath, [fileURLToPath(new URL('./moneris-sandbox.mjs', import.meta.url)), `--${input.suite}`, '--hosted-token-stdin'], { stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdin.on('error', () => {})
    child.stdin.end(input.token)
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 500000) child.kill() })
    child.stderr.on('data', () => {}) // Never echo runtime/provider internals into browser.
    child.on('error', () => { busy = false; if (!res.writableEnded) res.end(JSON.stringify({ ok: false, error: 'Runner could not start' })) })
    child.on('close', code => {
      busy = false
      const events = output.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
      const final = events.findLast(event => event.checks)
      if (!res.writableEnded) res.end(JSON.stringify({ ok: code === 0 && Boolean(final), runId: final?.runId, checks: final?.checks,
        steps: events.filter(event => event.step).map(event => ({ step: event.step, httpStatus: event.httpStatus, paymentStatus: event.paymentStatus,
          refundStatus: event.refundStatus, title: event.title, detail: event.detail })) }))
    })
  } catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'Invalid sandbox request' })) }
}).listen(3100, 'localhost', () => console.log('Saturn hosted sandbox ready at http://localhost:3100'))
