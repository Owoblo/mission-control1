/**
 * Saturn Star — Lead Intake Worker
 * Cloudflare Worker: receives webhooks from all lead sources,
 * normalizes them, and writes to Supabase inbound_leads table.
 *
 * Deploy URL: https://lead-intake.YOUR-SUBDOMAIN.workers.dev
 * or mapped to: https://workers.starmovers.ca/lead-intake
 *
 * Sources handled:
 *   POST /lead-intake          — website form (JSON)
 *   POST /lead-intake/twilio   — Twilio calls & SMS (form-encoded)
 *   POST /lead-intake/zapier   — Zapier (Facebook, Instagram, Email)
 */

export default {
    async fetch(request, env) {
        // ── CORS preflight ──
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        const url  = new URL(request.url);
        const path = url.pathname.replace(/\/$/, '');

        // quote lookup supports GET
        if (request.method === 'GET' && path.endsWith('/quote-accept')) {
            return handleQuoteLookup(request, env);
        }

        // voice-token supports GET
        if (request.method === 'GET' && path.endsWith('/voice-token')) {
            return handleVoiceToken(request, env);
        }

        // Recording proxy supports GET
        if (request.method === 'GET' && path.match(/\/recording\/[A-Za-z0-9]+$/)) {
            const sid = path.split('/').pop();
            return handleRecordingProxy(sid, env);
        }

        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // ── Utility routes (GET or POST) ──
        if (path.endsWith('/quote-accept'))   return handleQuoteAccept(request, env);
        if (path.endsWith('/send-sms'))      return handleSendSMS(request, env);
        if (path.endsWith('/send-email'))    return handleSendEmail(request, env);
        if (path.endsWith('/voice-token'))   return handleVoiceToken(request, env);
        if (path.endsWith('/voice-twiml'))   return handleVoiceTwiml(request, env);
        if (path.endsWith('/voice-inbound')) return handleVoiceInbound(request, env);
        if (path.endsWith('/recording-done')) return handleRecordingDone(request, env);

        try {
            let lead = null;

            // ── Route by path ──
            if (path.endsWith('/twilio')) {
                lead = await parseTwilio(request);
            } else if (path.endsWith('/zapier')) {
                lead = await parseZapier(request);
            } else {
                // Default: website form or any JSON source
                lead = await parseWebsite(request);
            }

            if (!lead) {
                return new Response('Could not parse lead data', { status: 400 });
            }

            // ── Write to Supabase ──
            const result = await writeToSupabase(lead, env);

            // ── Twilio requires a TwiML response for calls ──
            if (path.endsWith('/twilio') && lead.source === 'twilio_call') {
                return new Response(
                    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
                    { headers: { 'Content-Type': 'text/xml', ...corsHeaders() } }
                );
            }

            return new Response(JSON.stringify({ ok: true, id: result?.id || null }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });

        } catch (err) {
            console.error('Lead intake error:', err);
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }
    }
};

function getWorkerBaseUrl(request, env) {
    return (env.PUBLIC_WORKER_BASE_URL || `${new URL(request.url).origin}`).replace(/\/$/, '');
}

// ─────────────────────────────────────────────
// PARSERS
// ─────────────────────────────────────────────

/**
 * Twilio — handles both inbound calls and SMS
 * Twilio posts application/x-www-form-urlencoded
 */
async function parseTwilio(request) {
    const text = await request.text();
    const params = new URLSearchParams(text);

    const callSid  = params.get('CallSid');
    const msgSid   = params.get('MessageSid');
    const from     = params.get('From') || '';
    const body     = params.get('Body') || '';           // SMS body
    const status   = params.get('CallStatus') || '';
    const duration = params.get('CallDuration') || '';
    const recUrl   = params.get('RecordingUrl') || '';

    if (callSid) {
        // Inbound call
        const durationStr = duration ? `${Math.floor(Number(duration)/60)}m ${Number(duration)%60}s` : 'unknown duration';
        return {
            source:    'twilio_call',
            name:      '',
            phone:     formatPhone(from),
            email:     '',
            message:   recUrl
                ? `Inbound call — ${durationStr}. Recording: ${recUrl}`
                : `Inbound call — ${durationStr}. ${status === 'no-answer' ? 'No answer.' : 'Call ended.'}`,
            raw:       { callSid, status, duration, recUrl, from },
        };
    }

    if (msgSid) {
        // Inbound SMS
        return {
            source:  'twilio_sms',
            name:    '',
            phone:   formatPhone(from),
            email:   '',
            message: body,
            raw:     { msgSid, from, body },
        };
    }

    return null;
}

/**
 * Website form — expects JSON body
 * { name, phone, email, message, source? }
 */
async function parseWebsite(request) {
    let data = {};
    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('application/json')) {
        data = await request.json();
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await request.text();
        const params = new URLSearchParams(text);
        params.forEach((v, k) => { data[k] = v; });
    } else {
        // Try JSON anyway
        try { data = await request.json(); } catch { return null; }
    }

    return {
        source:  data.source || 'website_form',
        name:    data.name || data.full_name || '',
        phone:   formatPhone(data.phone || data.phone_number || ''),
        email:   data.email || '',
        message: data.message || data.notes || data.inquiry || '',
        raw:     data,
    };
}

/**
 * Zapier — handles Facebook DMs, Instagram DMs, Email
 * Zapier sends JSON with a `source` field you set in the zap
 * Expected: { source, name, phone, email, message, raw? }
 */
async function parseZapier(request) {
    let data = {};
    try { data = await request.json(); } catch { return null; }

    const source = data.source || 'unknown';
    const validSources = ['facebook_dm', 'instagram_dm', 'email', 'facebook_comment', 'instagram_comment'];

    return {
        source:  validSources.includes(source) ? source : 'unknown',
        name:    data.name || data.sender_name || data.from_name || '',
        phone:   formatPhone(data.phone || ''),
        email:   data.email || data.from_email || '',
        message: data.message || data.text || data.body || data.snippet || '',
        raw:     data,
    };
}

// ─────────────────────────────────────────────
// SUPABASE WRITE
// ─────────────────────────────────────────────

async function writeToSupabase(lead, env) {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_KEY;

    if (!url || !key) {
        console.warn('Supabase env vars not set — lead not persisted:', lead);
        return null;
    }

    const payload = {
        source:     lead.source,
        name:       lead.name || null,
        phone:      lead.phone || null,
        email:      lead.email || null,
        message:    lead.message || null,
        raw_data:   lead.raw ? JSON.stringify(lead.raw) : null,
        claimed:    false,
        created_at: new Date().toISOString(),
    };

    const res = await fetch(`${url}/rest/v1/inbound_leads`, {
        method:  'POST',
        headers: {
            'apikey':       key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Prefer':       'return=representation',
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase write failed: ${res.status} ${err}`);
    }

    const rows = await res.json();
    return rows[0] || null;
}

function getSupabaseConfig(env) {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_KEY;
    if (!url || !key) throw new Error('Supabase is not configured');
    return {
        url,
        headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
        },
    };
}

async function fetchCrmRecord(table, id, env) {
    const { url, headers } = getSupabaseConfig(env);
    const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,data&limit=1`, { headers });
    if (!res.ok) throw new Error(`Failed to fetch ${table}`);
    const rows = await res.json();
    return rows?.[0] || null;
}

async function patchCrmRecord(table, id, data, env) {
    const { url, headers } = getSupabaseConfig(env);
    const updatedAt = new Date().toISOString();
    const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            ...headers,
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ data, updated_at: updatedAt }),
    });
    if (!res.ok) throw new Error(`Failed to update ${table}`);
}

async function findInboundLeadByCallSid(callSid, env) {
    const { url, headers } = getSupabaseConfig(env);
    const res = await fetch(
        `${url}/rest/v1/inbound_leads?select=id,raw_data,message,created_at,phone&order=created_at.desc&limit=50`,
        { headers }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    for (const row of rows || []) {
        let raw = row?.raw_data || null;
        if (typeof raw === 'string') {
            try {
                raw = JSON.parse(raw);
            } catch {
                raw = null;
            }
        }
        if (raw && raw.callSid === callSid) {
            return row;
        }
    }
    return null;
}

async function findCrmLeadByInboundId(inboundId, env) {
    const { url, headers } = getSupabaseConfig(env);
    const res = await fetch(
        `${url}/rest/v1/crm_leads?select=id,data&data->>inboundId=eq.${encodeURIComponent(inboundId)}&order=updated_at.desc&limit=1`,
        { headers }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
}

async function saveCallSidMapping(callSid, leadId, callLogId, env) {
    const { url, headers } = getSupabaseConfig(env);
    const res = await fetch(`${url}/rest/v1/crm_call_sids`, {
        method: 'POST',
        headers: {
            ...headers,
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ call_sid: callSid, lead_id: leadId, call_log_id: callLogId }),
    });
    if (!res.ok) throw new Error('Failed to save call SID mapping');
}

async function patchInboundLead(id, updates, env) {
    const { url, headers } = getSupabaseConfig(env);
    const res = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: {
            ...headers,
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`Failed to update inbound lead ${id}`);
}

function sanitizeQuoteForPublic(quote) {
    const { acceptToken, leadId, ...publicQuote } = quote;
    return publicQuote;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function formatPhone(raw) {
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
        return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
        return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
    }
    return raw; // return as-is if unrecognized format
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

// ─────────────────────────────────────────────
// VOICE DIALER — Token + TwiML
// ─────────────────────────────────────────────

async function handleVoiceToken(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (!authorizeInternalRequest(request, env)) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    const accountSid   = env.TWILIO_ACCOUNT_SID;
    const apiKeySid    = env.TWILIO_API_KEY_SID;
    const apiKeySecret = env.TWILIO_API_KEY_SECRET;
    const twimlAppSid  = env.TWILIO_TWIML_APP_SID;

    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
        return new Response(JSON.stringify({ ok: false, error: 'Voice not configured' }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    const now = Math.floor(Date.now() / 1000);
    const header  = { alg: 'HS256', cty: 'twilio-fpa;v=1', typ: 'JWT' };
    const payload = {
        jti: `${apiKeySid}-${now}`,
        iss: apiKeySid,
        sub: accountSid,
        exp: now + 3600,
        grants: {
            identity: 'saturn-crm',
            voice: {
                outgoing: { application_sid: twimlAppSid },
                incoming: { allow: true },
            },
        },
    };

    // Base64url encode
    const b64url = obj => btoa(JSON.stringify(obj))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const unsigned = `${b64url(header)}.${b64url(payload)}`;

    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(apiKeySecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const token = `${unsigned}.${sigB64}`;

    return new Response(JSON.stringify({ ok: true, token }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

async function handleVoiceTwiml(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    let to = '';
    try {
        const text = await request.text();
        const params = new URLSearchParams(text);
        to = params.get('To') || '';
    } catch {}

    if (!to) {
        return new Response(`<?xml version="1.0"?><Response><Say>No destination provided.</Say></Response>`,
            { headers: { 'Content-Type': 'text/xml', ...corsHeaders() } });
    }

    const callerNumber = env.TWILIO_CALLER_ID || env.TWILIO_FROM_NUMBER || '+12267732993';
    const workerBase = getWorkerBaseUrl(request, env);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerNumber}" record="record-from-answer" recordingStatusCallback="${workerBase}/recording-done" timeLimit="3600">
    <Number>${to}</Number>
  </Dial>
</Response>`;

    return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml', ...corsHeaders() }
    });
}

async function handleQuoteLookup(request, env) {
    const quoteId = new URL(request.url).searchParams.get('id') || '';
    const token = new URL(request.url).searchParams.get('token') || '';
    if (!quoteId || !token) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing quote credentials' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    try {
        const row = await fetchCrmRecord('crm_quotes', quoteId, env);
        if (!row?.data || row.data.acceptToken !== token) {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid quote link' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }

        let clientName = row.data.clientName || '';
        if (!clientName && row.data.clientId) {
            const clientRow = await fetchCrmRecord('crm_clients', row.data.clientId, env).catch(() => null);
            clientName = clientRow?.data?.name || '';
        }

        return new Response(JSON.stringify({ ok: true, quote: sanitizeQuoteForPublic(row.data), clientName }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
}

async function handleQuoteAccept(request, env) {
    let data = {};
    try { data = await request.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders() }); }

    const quoteId = data.id || '';
    const token = data.token || '';
    if (!quoteId || !token) {
        return new Response(JSON.stringify({ ok: false, error: 'Missing quote credentials' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    try {
        const row = await fetchCrmRecord('crm_quotes', quoteId, env);
        if (!row?.data || row.data.acceptToken !== token) {
            return new Response(JSON.stringify({ ok: false, error: 'Invalid quote link' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders() }
            });
        }

        const now = new Date().toISOString();
        const updatedQuote = { ...row.data, status: 'accepted', acceptedAt: now, respondedAt: row.data.respondedAt || now };
        await patchCrmRecord('crm_quotes', quoteId, updatedQuote, env);

        if (row.data.leadId) {
            const leadRow = await fetchCrmRecord('crm_leads', row.data.leadId, env).catch(() => null);
            if (leadRow?.data) {
                const updatedLead = {
                    ...leadRow.data,
                    quoteId,
                    stage: 'booked',
                    followUpDate: null,
                    updatedAt: now,
                };
                await patchCrmRecord('crm_leads', row.data.leadId, updatedLead, env);
            }
        }

        return new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
}

// ─────────────────────────────────────────────
// INBOUND CALL HANDLER
// Rings browser (Mission Control) + personal cell simultaneously.
// First to answer wins. Call is recorded either way.
// Point Twilio number's Voice webhook here:
//   {PUBLIC_WORKER_BASE_URL}/voice-inbound
// ─────────────────────────────────────────────

async function handleVoiceInbound(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    const personalCell  = env.PERSONAL_CELL || '+12267241730';
    const workerBase    = getWorkerBaseUrl(request, env);

    // Log the inbound call to Supabase (best-effort)
    try {
        const text   = await request.clone().text();
        const params = new URLSearchParams(text);
        const from   = params.get('From') || '';
        if (from) {
            await writeToSupabase({
                source:  'twilio_call',
                name:    '',
                phone:   formatPhone(from),
                email:   '',
                message: 'Inbound call — ringing now',
                raw:     { from, callSid: params.get('CallSid'), status: 'ringing' },
            }, env);
        }
    } catch {}

    // Simultaneous ring: browser client + personal cell
    // Record from answer, 1hr time limit
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" record="record-from-answer"
        recordingStatusCallback="${workerBase}/recording-done"
        timeLimit="3600">
    <Client>saturn-crm</Client>
    <Number>${personalCell}</Number>
  </Dial>
  <Say>Sorry, we missed your call. Please try again or send us a text.</Say>
</Response>`;

    return new Response(twiml, {
        headers: { 'Content-Type': 'text/xml', ...corsHeaders() }
    });
}

// ─────────────────────────────────────────────
// OUTBOUND EMAIL (via Zoho Mail API)
// ─────────────────────────────────────────────

async function getZohoAccessToken(env) {
    const res = await fetch('https://accounts.zohocloud.ca/oauth/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: env.ZOHO_REFRESH_TOKEN,
            client_id:     env.ZOHO_CLIENT_ID,
            client_secret: env.ZOHO_CLIENT_SECRET,
            grant_type:    'refresh_token',
        }).toString(),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error('Zoho token refresh failed: ' + JSON.stringify(data));
    return data.access_token;
}

async function handleSendEmail(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (!authorizeInternalRequest(request, env)) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
    let data = {};
    try { data = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    const { to, subject, body, htmlBody } = data;
    if (!to || !subject || !body) return new Response('Missing to, subject, or body', { status: 400 });

    try {
        const token = await getZohoAccessToken(env);
        const accountId = '430781000000002002';
        const res = await fetch(`https://mail.zohocloud.ca/api/accounts/${accountId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Zoho-oauthtoken ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fromAddress: 'business@starmovers.ca',
                toAddress:   to,
                subject:     subject,
                content:     htmlBody || body,
                mailFormat:  htmlBody ? 'html' : 'plaintext',
            }),
        });
        const result = await res.json();
        if (!res.ok || result.status?.code !== 200) {
            throw new Error(result.status?.description || result.message || 'Send failed');
        }
        return new Response(JSON.stringify({ ok: true, messageId: result.data?.messageId }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
}

// ─────────────────────────────────────────────
// OUTBOUND SMS (via Twilio REST API)
// ─────────────────────────────────────────────

async function handleSendSMS(request, env) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
    }
    if (!authorizeInternalRequest(request, env)) {
        return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
    let data = {};
    try { data = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    const { to, body } = data;
    if (!to || !body) return new Response('Missing to or body', { status: 400 });

    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken  = env.TWILIO_AUTH_TOKEN;
    const fromNum    = env.TWILIO_FROM_NUMBER || '+12267732993';

    if (!accountSid || !authToken) {
        return new Response(JSON.stringify({ ok: false, error: 'Twilio not configured' }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: fromNum, Body: body }).toString(),
    });

    const result = await res.json();
    if (!res.ok) {
        return new Response(JSON.stringify({ ok: false, error: result.message }), {
            status: res.status, headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
    }
    return new Response(JSON.stringify({ ok: true, sid: result.sid }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
    });
}

function authorizeInternalRequest(request, env) {
    const expected = env.WORKER_SHARED_SECRET;
    if (!expected) return false;
    return request.headers.get('x-internal-secret') === expected;
}

// ─────────────────────────────────────────────
// RECORDING DONE — Twilio posts here after call recording is ready
// Looks up the lead by CallSid, patches the callLog entry with the recording URL
// ─────────────────────────────────────────────

async function handleRecordingDone(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    let params;
    try {
        const text = await request.text();
        params = new URLSearchParams(text);
    } catch { return new Response('ok'); }

    const callSid      = params.get('CallSid')      || '';
    const recordingSid = params.get('RecordingSid') || '';
    const duration     = params.get('RecordingDuration') || '0';
    if (!callSid || !recordingSid) return new Response('ok');

    const sbUrl = env.SUPABASE_URL;
    const sbKey = env.SUPABASE_KEY;
    const sbH   = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey, 'Content-Type': 'application/json' };

    try {
        const recordingUrl = `${getWorkerBaseUrl(request, env)}/recording/${recordingSid}`;
        const inbound = await findInboundLeadByCallSid(callSid, env);

        // Mirror recording info onto the inbound row first so Inbox can update even
        // when crm_call_sids mapping does not exist yet for forwarded inbound calls.
        if (inbound?.id) {
            const rawData = typeof inbound.raw_data === 'string'
                ? JSON.parse(inbound.raw_data)
                : (inbound.raw_data || {});
            rawData.recordingUrl = recordingUrl;
            rawData.recordingSid = recordingSid;
            rawData.recordingDuration = parseInt(duration, 10);
            rawData.status = 'recorded';
            await patchInboundLead(inbound.id, {
                raw_data: rawData,
                message: `Inbound call — ${Math.floor(parseInt(duration, 10) / 60)}m ${parseInt(duration, 10) % 60}s recording ready`,
            }, env);
        }

        // Look up which lead this call belongs to. Prefer explicit mapping, but fall
        // back to the auto-created inbound lead when inbound forwarding is used.
        let lead_id = '';
        let call_log_id = '';

        const mapRes = await fetch(`${sbUrl}/rest/v1/crm_call_sids?call_sid=eq.${encodeURIComponent(callSid)}&select=lead_id,call_log_id`, {
            headers: sbH
        });
        const maps = await mapRes.json();
        if (maps && maps.length > 0) {
            lead_id = maps[0].lead_id;
            call_log_id = maps[0].call_log_id;
        } else if (inbound?.id) {
            const leadRow = await findCrmLeadByInboundId(inbound.id, env);
            if (leadRow?.id && leadRow?.data) {
                lead_id = leadRow.id;
                const callLogs = leadRow.data.callLogs || [];
                const matchingLog = callLogs.find(log => log.callSid === callSid) || callLogs.find(log => log.type === 'call');
                call_log_id = matchingLog?.id || '';
                if (call_log_id) {
                    await saveCallSidMapping(callSid, lead_id, call_log_id, env).catch(() => {});
                }
            }
        }

        if (!lead_id) return new Response('ok');

        // Fetch the lead's data
        const leadRes = await fetch(`${sbUrl}/rest/v1/crm_leads?id=eq.${encodeURIComponent(lead_id)}&select=id,data`, {
            headers: sbH
        });
        const leads = await leadRes.json();
        if (!leads || leads.length === 0) return new Response('ok');

        const lead = leads[0].data;
        const callLogs = lead.callLogs || [];
        let idx = callLogs.findIndex(l => l.id === call_log_id);
        if (idx < 0) idx = callLogs.findIndex(l => l.callSid === callSid);

        if (idx > -1) {
            callLogs[idx].recordingUrl = recordingUrl;
            callLogs[idx].recordingSid = recordingSid;
            callLogs[idx].recordingDuration = parseInt(duration, 10);
            callLogs[idx].callSid = callSid;
        } else {
            call_log_id = callSid;
            callLogs.unshift({
                id: callSid,
                type: 'call',
                notes: `Call recorded — ${Math.floor(parseInt(duration)/60)}m ${parseInt(duration)%60}s`,
                date: new Date().toISOString(),
                recordingUrl,
                recordingSid,
                recordingDuration: parseInt(duration, 10),
                callSid,
                source: 'inbound',
            });
            idx = 0;
            await saveCallSidMapping(callSid, lead_id, call_log_id, env).catch(() => {});
        }

        lead.callLogs  = callLogs;
        lead.updatedAt = new Date().toISOString();

        await fetch(`${sbUrl}/rest/v1/crm_leads?id=eq.${encodeURIComponent(lead_id)}`, {
            method:  'PATCH',
            headers: { ...sbH, 'Prefer': 'return=minimal' },
            body:    JSON.stringify({ data: lead, updated_at: lead.updatedAt }),
        });

        // ── Transcribe + AI summary (async, best-effort) ──
        if (env.OPENAI_API_KEY && parseInt(duration, 10) > 10) {
            transcribeAndSummarize(recordingSid, callSid, lead, lead_id, call_log_id, idx, sbUrl, sbH, env).catch(e => console.error('transcribe error:', e));
        }

    } catch (e) {
        console.error('recording-done error:', e);
    }

    return new Response('ok', { headers: corsHeaders() });
}

async function transcribeAndSummarize(recordingSid, callSid, lead, leadId, callLogId, logIdx, sbUrl, sbH, env) {
    // 1. Fetch audio from Twilio
    const audioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${recordingSid}.mp3`;
    const audioRes = await fetch(audioUrl, {
        headers: { 'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`) }
    });
    if (!audioRes.ok) return;
    const audioBlob = await audioRes.blob();

    // 2. Transcribe via OpenAI Whisper
    const form = new FormData();
    form.append('file', new File([audioBlob], `${recordingSid}.mp3`, { type: 'audio/mpeg' }));
    form.append('model', 'whisper-1');
    form.append('language', 'en');

    const transcriptRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` },
        body:    form,
    });
    if (!transcriptRes.ok) return;
    const { text: transcript } = await transcriptRes.json();
    if (!transcript) return;

    // 3. AI analysis via GPT-4o-mini
    const systemPrompt = `You are an AI sales coach for Saturn Star Moving Company. Analyze this call transcript.

The purpose of every call is to BOOK THE MOVE. Secondary goals: provide estimate, build rapport, get contact info, identify the real decision-maker.

Key principles (Moving Sales Academy / Greg Sheppard):
- Ask "Why are you moving?" first — be interested, not interesting
- Control the conversation, lead back to booking
- Create urgency (crew availability, peak season)
- Never badmouth competition
- Always ask for the business on every call
- Price is #7 on why people buy — rapport and trust come first

Your job: extract actionable intelligence so the sales rep knows EXACTLY what to do next and when.

For followUpDays: read the transcript carefully. If the customer said "I'll decide by Friday", "calling around this week", "need to check with spouse", "not moving until March" — translate that into the right number of days. Default to 2 if unclear. Use 1 if they seemed very interested. Use 5-7 if they're early-stage shopping.

Return JSON only (no markdown):
{
  "summary": "2-3 sentences covering what was discussed and where the lead stands",
  "leadConcern": "their main worry, objection, or specific need",
  "decisionMaker": "who makes the final call — customer alone, spouse, employer, etc.",
  "nextAction": "specific word-for-word action the rep should take next",
  "followUpDays": 2,
  "followUpReason": "short phrase explaining why this timeframe — e.g. 'customer deciding this weekend' or 'needs to confirm move date with landlord'",
  "coachingTip": "one specific improvement the rep can make based on this call",
  "moveReadiness": "hot|warm|cold"
}`;

    const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model:           'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Lead: ${lead.name || 'Unknown'}\nPhone: ${lead.phone || ''}\n\nTranscript:\n${transcript}` }
            ],
            response_format: { type: 'json_object' },
            max_tokens: 600,
        }),
    });
    let aiSummary = null;
    if (aiRes.ok) {
        const aiData = await aiRes.json();
        try { aiSummary = JSON.parse(aiData.choices[0].message.content); } catch {}
    }

    // 4. Patch the callLog entry with transcript + AI summary
    const callLogs = lead.callLogs || [];
    const idx = callLogs.findIndex(l => l.id === callLogId);
    const update = { transcript, aiSummary };
    if (idx > -1) {
        Object.assign(callLogs[idx], update);
        // Update the note to remove "Recording processing…"
        callLogs[idx].notes = callLogs[idx].notes?.replace(' Recording processing…', '');
    }
    lead.callLogs  = callLogs;

    // 5. Auto-set follow-up date from AI suggestion
    if (aiSummary?.followUpDays && !lead.followUpDate) {
        const fuDate = new Date();
        fuDate.setDate(fuDate.getDate() + parseInt(aiSummary.followUpDays, 10));
        lead.followUpDate = fuDate.toISOString().split('T')[0];
        lead.followUpNote = aiSummary.followUpReason || '';
    }

    lead.updatedAt = new Date().toISOString();

    await fetch(`${sbUrl}/rest/v1/crm_leads?id=eq.${encodeURIComponent(leadId)}`, {
        method:  'PATCH',
        headers: { ...sbH, 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ data: lead, updated_at: lead.updatedAt }),
    });

    // Mirror transcript + AI summary onto the related inbound row so Inbox can show it pre-claim
    const inbound = await findInboundLeadByCallSid(callSid, env);
    if (inbound?.id) {
        const rawData = typeof inbound.raw_data === 'string'
            ? JSON.parse(inbound.raw_data)
            : (inbound.raw_data || {});
        rawData.transcript = transcript;
        rawData.aiSummary = aiSummary;
        rawData.status = 'analyzed';
        await patchInboundLead(inbound.id, {
            raw_data: rawData,
            message: aiSummary?.summary || inbound.message || 'Inbound call analyzed',
        }, env);
    }
}

// ─────────────────────────────────────────────
// RECORDING PROXY — streams Twilio recording audio (requires auth)
// GET /recording/{recordingSid}
// ─────────────────────────────────────────────

async function handleRecordingProxy(recordingSid, env) {
    const accountSid = env.TWILIO_ACCOUNT_SID;
    const authToken  = env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
        return new Response('Not configured', { status: 500, headers: corsHeaders() });
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
    try {
        const res = await fetch(url, {
            headers: { 'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`) }
        });
        if (!res.ok) return new Response('Recording not found', { status: 404, headers: corsHeaders() });
        return new Response(res.body, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'private, max-age=86400',
                ...corsHeaders(),
            }
        });
    } catch (e) {
        return new Response('Proxy error: ' + e.message, { status: 500, headers: corsHeaders() });
    }
}
