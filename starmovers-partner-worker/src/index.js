const RATE_ROWS = [
  ['2 movers + 1 truck', '$160/hr', 'Small apartments, condos, lighter local moves'],
  ['3 movers + 1 truck', '$225/hr', 'Most homes and larger apartments'],
  ['4 movers + 1 truck', '$270/hr', 'Heavy homes or faster load/unload plans'],
  ['4 movers + 2 trucks', '$290/hr', 'Two-truck volume with efficient pricing'],
  ['5 movers + 2 trucks', '$350/hr', 'Large homes, tight timing, commercial'],
  ['6 movers + 2 trucks', '$395/hr', 'Large homes or complex office moves'],
]

const LABOR_ROWS = [
  ['2 movers', '$120/hr'],
  ['3 movers', '$150/hr'],
  ['4 movers', '$200/hr'],
]

const SERVICE_AREAS = [
  'Windsor',
  'London',
  'Kitchener / Waterloo',
  'Guelph',
  'Chatham',
  'Nearby Ontario communities by request',
]

const FLYERS = {
  chatham: { label: 'Chatham flyer', file: 'chatham.pdf' },
  guelph: { label: 'Guelph flyer', file: 'guelph.pdf' },
  kitchener: { label: 'Kitchener flyer', file: 'kitchener.pdf' },
  london: { label: 'London flyer', file: 'london.pdf' },
  waterloo: { label: 'Waterloo flyer', file: 'waterloo.pdf' },
  windsor: { label: 'Windsor flyer', file: 'windsor.pdf' },
}

const MARKETS = {
  windsor: {
    label: 'Windsor / Essex',
    baseCity: 'Windsor',
    phone: '226-773-2993',
    areas: ['Windsor', 'Tecumseh', 'LaSalle', 'Amherstburg', 'Essex', 'Lakeshore', 'Leamington', 'Kingsville', 'Chatham-Kent'],
    patterns: [/\bwindsor\b/i, /\bessex\b/i, /\btecumseh\b/i, /\blasalle\b/i, /\bla-salle\b/i, /\bamherstburg\b/i, /\bleamington\b/i, /\bkingsville\b/i, /\bchatham\b/i],
  },
  london: {
    label: 'London / Southwestern Ontario',
    baseCity: 'London',
    phone: '548-488-3245',
    areas: ['London', 'St. Thomas', 'Woodstock', 'Strathroy', 'Ingersoll', 'Tillsonburg', 'Sarnia', 'Oxford County'],
    patterns: [/\blondon\b/i, /\bst-?thomas\b/i, /\bst\.?\s*thomas\b/i, /\bwoodstock\b/i, /\bstrathroy\b/i, /\bingersoll\b/i, /\btillsonburg\b/i, /\bsarnia\b/i],
  },
  waterloo: {
    label: 'Kitchener / Waterloo',
    baseCity: 'Kitchener-Waterloo',
    phone: '226-780-6649',
    areas: ['Kitchener', 'Waterloo', 'Cambridge', 'Guelph', 'Elmira', 'New Hamburg', 'Ayr', 'Brantford'],
    patterns: [/\bkitchener\b/i, /\bwaterloo\b/i, /\bkw\b/i, /\bcambridge\b/i, /\bguelph\b/i, /\belmira\b/i, /\bnew-?hamburg\b/i, /\bbrantford\b/i],
  },
  guelph: {
    label: 'Guelph / Wellington',
    baseCity: 'Guelph',
    phone: '226-780-7014',
    areas: ['Guelph', 'Fergus', 'Elora', 'Cambridge', 'Kitchener', 'Waterloo', 'Wellington County'],
    patterns: [/\bguelph\b/i, /\bfergus\b/i, /\belora\b/i, /\bwellington\b/i],
  },
}

function flyerForContext(url, partner, market) {
  const requested = String(url.searchParams.get('city') || url.searchParams.get('market') || '').toLowerCase()
  const haystack = `${requested} ${partner?.code || ''}`.replace(/[_-]+/g, ' ')
  if (/\bchatham\b/.test(haystack)) return FLYERS.chatham
  if (/\bguelph\b/.test(haystack)) return FLYERS.guelph
  if (/\bkitchener\b/.test(haystack)) return FLYERS.kitchener
  if (/\blondon\b/.test(haystack)) return FLYERS.london
  if (/\b(waterloo|cambridge|elmira|new hamburg|ayr|brantford)\b/.test(haystack)) return FLYERS.waterloo
  if (/\b(windsor|essex|lasalle|tecumseh|amherstburg|leamington|kingsville)\b/.test(haystack)) return FLYERS.windsor

  if (market?.key === 'london') return FLYERS.london
  if (market?.key === 'waterloo') return FLYERS.waterloo
  if (market?.key === 'guelph') return FLYERS.guelph
  return FLYERS.windsor
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function titleCase(value = '') {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '')
    .join(' ')
}

function referralNameParts(code = '') {
  const ignored = new Set([
    'remax', 'royal', 'lepage', 'century', 'kw', 'keller', 'williams', 'realty', 'realtor', 'broker', 'team', 'group', 'inc',
    'windsor', 'essex', 'lasalle', 'tecumseh', 'london', 'kitchener', 'waterloo', 'cambridge', 'guelph', 'chatham',
  ])
  const words = String(code || '')
    .split(/[-_\s]+/)
    .map(word => word.trim().replace(/[^a-z0-9]/gi, ''))
    .filter(word => word && !ignored.has(word.toLowerCase()))
  return {
    first: words[0] || 'star',
    last: words[1] || '',
  }
}

function shortMarketCode(code = '') {
  if (/\blondon\b/i.test(code)) return 'LD'
  if (/\b(kitchener|waterloo|cambridge|kw)\b/i.test(code)) return 'KW'
  if (/\bguelph\b/i.test(code)) return 'GU'
  if (/\b(chatham)\b/i.test(code)) return 'CH'
  if (/\b(windsor|essex|lasalle|tecumseh)\b/i.test(code)) return 'WI'
  return 'SS'
}

function readableReferralCode(code = '') {
  const { first, last } = referralNameParts(code)
  const namePart = `${first.slice(0, 4)}${last ? last[0] : ''}`.toUpperCase()
  return `${namePart}${shortMarketCode(code)}`.replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

function partnerFromCode(code) {
  const clean = String(code || 'partner')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'partner'
  const label = titleCase(clean)
  return {
    code: clean,
    name: label === 'Partner' ? 'Partner' : label,
    displayName: label === 'Partner' ? 'your team' : label,
    shortCode: readableReferralCode(clean),
  }
}

function detectMarket(url, code) {
  const requested = String(url.searchParams.get('city') || url.searchParams.get('market') || '').toLowerCase()
  const haystack = `${requested} ${code || ''}`.replace(/[_-]+/g, ' ')
  for (const [key, market] of Object.entries(MARKETS)) {
    if (requested === key || requested === market.baseCity.toLowerCase()) return { key, ...market }
    if (market.patterns.some(pattern => pattern.test(haystack))) return { key, ...market }
  }
  return { key: 'windsor', ...MARKETS.windsor }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  })
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=120',
    },
  })
}

async function parseForm(request) {
  const type = request.headers.get('content-type') || ''
  if (type.includes('application/json')) return request.json()
  const form = await request.formData()
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value || '')]))
}

async function handleReferral(request, env, partner, market) {
  if (request.method === 'OPTIONS') return json({ ok: true })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await parseForm(request)
  const name = String(body.client_name || body.name || '').trim()
  const phone = String(body.client_phone || body.phone || '').trim()
  const email = String(body.client_email || body.email || '').trim()
  const address = String(body.moving_from || body.address || '').trim()
  const movingTo = String(body.moving_to || '').trim()
  const moveDate = String(body.move_date || '').trim()
  const moveSize = String(body.move_size || '').trim()
  const note = String(body.notes || '').trim()
  const partnerName = String(body.partner_name || partner.name || '').trim()
  const partnerCode = String(body.partner_code || partner.shortCode || partner.code).trim()
  const partnerSlug = String(body.partner_slug || partner.code).trim()

  if (!name && !phone && !email) {
    return json({ error: 'Please include a client name, phone, or email.' }, 400)
  }

  const payload = {
    partner_code: partnerCode,
    partner_slug: partnerSlug,
    partner_name: partnerName,
    market: market?.key || String(body.market || '').trim(),
    client_name: name,
    client_phone: phone,
    client_email: email,
    moving_from: address,
    moving_to: movingTo,
    move_date: moveDate,
    move_size: moveSize,
    notes: note,
    source_url: request.headers.get('referer') || '',
  }

  let forwarded = false
  if (env.CRM_CAPTURE_URL) {
    try {
      const res = await fetch(env.CRM_CAPTURE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      forwarded = res.ok
    } catch {
      forwarded = false
    }
  }

  return json({
    ok: true,
    forwarded,
    message: forwarded
      ? 'Referral received. Saturn Star Movers will follow up.'
      : 'Referral received. Please also call/text Saturn Star Movers if it is urgent.',
  })
}

async function serveAsset(request, env) {
  if (!env.ASSETS) return new Response('Asset binding is not configured', { status: 500 })
  const res = await env.ASSETS.fetch(request)
  const headers = new Headers(res.headers)
  if ((headers.get('content-type') || '').includes('application/pdf')) {
    headers.set('content-disposition', 'inline')
    headers.set('cache-control', 'public, max-age=86400')
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

function renderPage(request, env, partner, market) {
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`
  const packageUrl = `${origin}/partner/${partner.code}?city=${encodeURIComponent(market.key)}`
  const clientQuoteUrl = `${origin}/quote?ref=${encodeURIComponent(partner.shortCode)}&partner=${encodeURIComponent(partner.code)}&market=${encodeURIComponent(market.key)}`
  const flyer = flyerForContext(url, partner, market)
  const flyerUrl = `${origin}/partner/flyers/${flyer.file}`
  const phone = market.phone || env.PUBLIC_PHONE || '226-773-2993'
  const email = env.PUBLIC_EMAIL || 'business@starmovers.ca'
  const title = `${partner.name} Referral Package | Saturn Star Movers`

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="Personal Saturn Star Movers referral package with rates, referral form, and client quote link.">
  <meta name="robots" content="noindex, nofollow">
  <style>
    :root{--navy:#1a2744;--ink:#162033;--muted:#64748b;--gold:#f5a623;--line:#dbe2ee;--soft:#f7f8fb;--green:#0f766e}
    *{box-sizing:border-box} body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:#fff;line-height:1.55}
    a{color:inherit}.wrap{max-width:1120px;margin:0 auto;padding:0 22px}.top{background:var(--navy);color:#fff}.nav{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 0}.brand{font-weight:800;letter-spacing:.02em}.nav a{color:#fff;text-decoration:none;font-weight:700;font-size:14px}
    .hero{background:linear-gradient(135deg,#1a2744 0%,#24355d 70%,#10213d 100%);color:#fff;padding:72px 0 48px}.eyebrow{display:inline-flex;border:1px solid rgba(245,166,35,.35);background:rgba(245,166,35,.12);color:#ffd58a;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    h1{font-size:clamp(34px,6vw,62px);line-height:1.02;margin:20px 0 16px;max-width:820px}h1 span{color:var(--gold)}.lead{font-size:clamp(17px,2.4vw,21px);color:rgba(255,255,255,.82);max-width:720px}.hero-grid{display:grid;grid-template-columns:1fr 340px;gap:32px;align-items:end}.package-card{background:#fff;color:var(--ink);border-radius:16px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.24)}.package-card code{display:block;word-break:break-all;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px;font-size:13px}
    .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:10px;border:2px solid transparent;padding:13px 18px;text-decoration:none;font-weight:800;cursor:pointer}.btn.gold{background:var(--gold);color:#111c35}.btn.white{border-color:rgba(255,255,255,.5);color:#fff}.btn.navy{background:var(--navy);color:#fff}.btn.line{border-color:var(--line);background:#fff;color:var(--navy)}
    section{padding:64px 0}.section-alt{background:var(--soft)}h2{font-size:clamp(26px,4vw,40px);line-height:1.12;color:var(--navy);margin:0 0 12px}.sub{color:var(--muted);max-width:720px;margin:0 0 28px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.card{border:1px solid var(--line);background:#fff;border-radius:14px;padding:22px;box-shadow:0 8px 24px rgba(15,23,42,.04)}.card h3{margin:0 0 8px;color:var(--navy)}
    .rate-table{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}.rate-row{display:grid;grid-template-columns:1.2fr .6fr 1.4fr;gap:12px;padding:14px 16px;border-top:1px solid var(--line);align-items:center}.rate-row:first-child{border-top:0;background:var(--navy);color:#fff;font-weight:800}.rate{font-weight:900;color:var(--green)}.rate-row:first-child .rate{color:#fff}
    .form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.form label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800}.field{display:flex;flex-direction:column;gap:6px}.field.full{grid-column:1/-1}input,textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit}textarea{min-height:92px;resize:vertical}.notice{border-left:4px solid var(--gold);background:#fff8ec;padding:14px;border-radius:10px;color:#6b4a00}.success{display:none;margin-top:14px;border:1px solid #99f6e4;background:#f0fdfa;color:#115e59;border-radius:12px;padding:14px;font-weight:800}
    .pill-list{display:flex;gap:8px;flex-wrap:wrap}.pill{background:#eef2f7;border:1px solid var(--line);border-radius:999px;padding:8px 11px;font-size:13px;font-weight:750;color:#334155}.footer{background:#111c35;color:#cbd5e1;padding:34px 0;font-size:14px}.footer a{color:#fff}.mini{font-size:12px;color:var(--muted)}
    @media(max-width:850px){.hero-grid,.grid{grid-template-columns:1fr}.rate-row{grid-template-columns:1fr}.form{grid-template-columns:1fr}.hero{padding-top:50px}}
  </style>
</head>
<body>
  <header class="top"><div class="wrap nav"><div class="brand">Saturn Star Movers</div><a href="tel:+1${phone.replace(/\\D/g, '')}">${escapeHtml(phone)}</a></div></header>
  <main>
    <section class="hero">
      <div class="wrap hero-grid">
        <div>
          <div class="eyebrow">Personal referral package</div>
          <h1>${escapeHtml(partner.displayName)}, your <span>Saturn Star Movers</span> referral page is ready.</h1>
          <p class="lead">Use this page when a client needs movers in the ${escapeHtml(market.label)} area. It includes your referral code, client quote link, rate guidance, local contact number, and a simple referral form.</p>
          <div class="actions">
            <a class="btn gold" href="${escapeHtml(clientQuoteUrl)}">Open client quote link</a>
            <a class="btn white" href="#refer">Submit a referral</a>
          </div>
        </div>
        <aside class="package-card">
          <h3>Your referral code</h3>
          <code>${escapeHtml(partner.shortCode)}</code>
          <p class="mini">Clients can use this link or mention your name/code when they call or text our ${escapeHtml(market.baseCity)} line.</p>
          <code>${escapeHtml(packageUrl)}</code>
          <p style="margin-top:14px"><a class="btn line" href="${escapeHtml(flyerUrl)}" target="_blank" rel="noopener">Download ${escapeHtml(flyer.label)}</a></p>
        </aside>
      </div>
    </section>

    <section>
      <div class="wrap grid">
        <div class="card"><h3>1. Share the link</h3><p>Send your client the quote link or have them call/text and mention your name.</p></div>
        <div class="card"><h3>2. We quote the move</h3><p>Saturn Star confirms inventory, access, truck plan, timing, and service needs.</p></div>
        <div class="card"><h3>3. You get credited</h3><p>Your referral is tagged to your code once the client books and completes the move.</p></div>
      </div>
    </section>

    <section class="section-alt">
      <div class="wrap">
        <h2>Rate card guidance</h2>
          <p class="sub">These are planning rates for common ${escapeHtml(market.label)} moves. Final pricing depends on inventory, access, distance, truck count, date, stairs/elevator/parking, packing, specialty items, and added stops.</p>
        <div class="rate-table">
          <div class="rate-row"><div>Crew plan</div><div>Rate</div><div>Best fit</div></div>
          ${RATE_ROWS.map(row => `<div class="rate-row"><div>${escapeHtml(row[0])}</div><div class="rate">${escapeHtml(row[1])}</div><div>${escapeHtml(row[2])}</div></div>`).join('')}
        </div>
        <p class="mini" style="margin-top:12px">3-hour minimum. HST is 13%. Hourly/non-binding jobs are based on actual time worked. Binding estimates are only locked once inventory, addresses, access, crew plan, and included services are confirmed.</p>
      </div>
    </section>

    <section>
      <div class="wrap grid">
        <div class="card">
          <h3>Labor-only guidance</h3>
          ${LABOR_ROWS.map(row => `<p><strong>${escapeHtml(row[0])}</strong>: ${escapeHtml(row[1])}</p>`).join('')}
        </div>
        <div class="card">
          <h3>Referral payout</h3>
          <p><strong>$100</strong> for a completed booked move.</p>
          <p><strong>$200</strong> for larger commercial, long-distance, or high-value jobs when approved.</p>
          <p class="mini">Paid by e-transfer after the move is complete and client payment is confirmed.</p>
        </div>
        <div class="card">
          <h3>${escapeHtml(market.baseCity)} service area</h3>
          <div class="pill-list">${market.areas.map(area => `<span class="pill">${escapeHtml(area)}</span>`).join('')}</div>
          <p class="mini" style="margin-top:12px">Broader coverage includes ${SERVICE_AREAS.map(escapeHtml).join(', ')}.</p>
        </div>
      </div>
    </section>

    <section class="section-alt" id="refer">
      <div class="wrap">
        <h2>Submit a client referral</h2>
        <p class="sub">Add the client here, or have them use the quote link. Either way, use referral code <strong>${escapeHtml(partner.shortCode)}</strong> and the ${escapeHtml(market.baseCity)} market.</p>
        <form class="card form" id="referral-form">
          <input type="hidden" name="partner_code" value="${escapeHtml(partner.shortCode)}">
          <input type="hidden" name="partner_slug" value="${escapeHtml(partner.code)}">
          <input type="hidden" name="partner_name" value="${escapeHtml(partner.name)}">
          <input type="hidden" name="market" value="${escapeHtml(market.key)}">
          <div class="field"><label>Client name</label><input name="client_name" autocomplete="name"></div>
          <div class="field"><label>Client phone</label><input name="client_phone" autocomplete="tel"></div>
          <div class="field"><label>Client email</label><input name="client_email" autocomplete="email"></div>
          <div class="field"><label>Moving from</label><input name="moving_from" autocomplete="street-address"></div>
          <div class="field full"><label>Notes</label><textarea name="notes" placeholder="Move date, destination city, home size, special instructions..."></textarea></div>
          <div class="field full"><button class="btn navy" type="submit">Submit referral</button><div class="success" id="success">Referral received.</div></div>
        </form>
      </div>
    </section>

    <section>
      <div class="wrap grid">
        <div class="card"><h3>Client quote link</h3><p><a href="${escapeHtml(clientQuoteUrl)}">${escapeHtml(clientQuoteUrl)}</a></p></div>
        <div class="card"><h3>${escapeHtml(market.baseCity)} call or text</h3><p><a href="tel:+1${phone.replace(/\\D/g, '')}">${escapeHtml(phone)}</a></p><p class="mini">Tell clients to mention ${escapeHtml(partner.name)} or code ${escapeHtml(partner.shortCode)}.</p></div>
        <div class="card"><h3>Postcards and flyer</h3><p>Need more cards or want us to stop by your office? Text/call us and we will coordinate a drop-off.</p><p><a href="${escapeHtml(flyerUrl)}" target="_blank" rel="noopener">${escapeHtml(flyer.label)}</a></p></div>
      </div>
    </section>
  </main>
  <footer class="footer"><div class="wrap">Saturn Star Movers · <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a> · <a href="tel:+1${phone.replace(/\\D/g, '')}">${escapeHtml(phone)}</a></div></footer>
  <script>
    const form = document.getElementById('referral-form');
    const success = document.getElementById('success');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Submitting...';
      try {
        const res = await fetch(location.pathname + '/referral', { method: 'POST', body: new FormData(form) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit referral');
        success.textContent = data.message || 'Referral received.';
        success.style.display = 'block';
        form.reset();
      } catch (error) {
        alert(error.message || 'Could not submit referral. Please call or text Saturn Star Movers.');
      } finally {
        button.disabled = false;
        button.textContent = 'Submit referral';
      }
    });
  </script>
</body>
</html>`)
}

function renderQuotePage(request, env) {
  const url = new URL(request.url)
  const ref = String(url.searchParams.get('ref') || 'partner')
  const partnerSlug = String(url.searchParams.get('partner') || ref)
  const partner = partnerFromCode(partnerSlug)
  const referralCode = ref === 'partner' ? partner.shortCode : ref.toUpperCase()
  const market = detectMarket(url, partnerSlug)
  const flyer = flyerForContext(url, partner, market)
  const phone = market.phone || env.PUBLIC_PHONE || '226-773-2993'
  const email = env.PUBLIC_EMAIL || 'business@starmovers.ca'
  const packageUrl = `${url.protocol}//${url.host}/partner/${partner.code}?city=${encodeURIComponent(market.key)}`
  const flyerUrl = `${url.protocol}//${url.host}/partner/flyers/${flyer.file}`

  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Moving Quote | Saturn Star Movers</title>
  <meta name="robots" content="noindex, nofollow">
  <style>
    :root{--navy:#1a2744;--ink:#162033;--muted:#64748b;--gold:#f5a623;--line:#dbe2ee;--soft:#f7f8fb;--green:#0f766e}
    *{box-sizing:border-box} body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--soft);line-height:1.55}
    .wrap{max-width:960px;margin:0 auto;padding:0 22px}.top{background:var(--navy);color:#fff}.nav{display:flex;align-items:center;justify-content:space-between;padding:16px 0}.brand{font-weight:900}.nav a{color:#fff;text-decoration:none;font-weight:800}
    .hero{background:linear-gradient(135deg,#1a2744,#24355d);color:#fff;padding:62px 0 44px}.eyebrow{display:inline-block;border:1px solid rgba(245,166,35,.35);background:rgba(245,166,35,.12);color:#ffd58a;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
    h1{font-size:clamp(34px,6vw,58px);line-height:1.04;margin:18px 0 14px}.lead{font-size:clamp(17px,2.4vw,21px);color:rgba(255,255,255,.82);max-width:720px}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:0 10px 28px rgba(15,23,42,.06);margin-top:-24px}.form{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:flex;flex-direction:column;gap:6px}.field.full{grid-column:1/-1}label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:900}input,textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:12px;font:inherit}textarea{min-height:108px;resize:vertical}.btn{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:10px;background:var(--navy);color:#fff;padding:13px 18px;font-weight:900;cursor:pointer}.success{display:none;margin-top:14px;border:1px solid #99f6e4;background:#f0fdfa;color:#115e59;border-radius:12px;padding:14px;font-weight:800}.mini{font-size:13px;color:var(--muted)}.pill{display:inline-flex;background:#eef2f7;border:1px solid var(--line);border-radius:999px;padding:7px 10px;font-size:13px;font-weight:800;color:#334155}.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.footer{padding:34px 0;color:var(--muted);font-size:14px}
    @media(max-width:760px){.form{grid-template-columns:1fr}.card{margin-top:0}}
  </style>
</head>
<body>
  <header class="top"><div class="wrap nav"><div class="brand">Saturn Star Movers</div><a href="tel:+1${phone.replace(/\\D/g, '')}">${escapeHtml(phone)}</a></div></header>
  <section class="hero"><div class="wrap">
    <div class="eyebrow">${escapeHtml(market.label)} referral quote</div>
    <h1>Get a moving quote from Saturn Star Movers.</h1>
    <p class="lead">You were referred by ${escapeHtml(partner.name)}. Send a few details and our ${escapeHtml(market.baseCity)} team will follow up with a quote.</p>
    <div class="meta"><span class="pill">Referral code: ${escapeHtml(referralCode)}</span><span class="pill">${escapeHtml(market.label)}</span></div>
  </div></section>
  <main class="wrap">
    <form class="card form" id="quote-form">
      <input type="hidden" name="partner_code" value="${escapeHtml(referralCode)}">
      <input type="hidden" name="partner_slug" value="${escapeHtml(partner.code)}">
      <input type="hidden" name="partner_name" value="${escapeHtml(partner.name)}">
      <input type="hidden" name="market" value="${escapeHtml(market.key)}">
      <div class="field"><label>Your name</label><input name="client_name" autocomplete="name" required></div>
      <div class="field"><label>Phone</label><input name="client_phone" autocomplete="tel" required></div>
      <div class="field"><label>Email</label><input name="client_email" autocomplete="email"></div>
      <div class="field"><label>Move date</label><input name="move_date" placeholder="Approximate is okay"></div>
      <div class="field"><label>Moving from</label><input name="moving_from" autocomplete="street-address"></div>
      <div class="field"><label>Moving to</label><input name="moving_to"></div>
      <div class="field full"><label>Move details</label><textarea name="notes" placeholder="Home size, apartment/house, stairs/elevator, packing, large items, destination city..."></textarea></div>
      <div class="field full"><button class="btn" type="submit">Request quote</button><div class="success" id="success">Quote request received.</div><p class="mini">Prefer to call/text? Use ${escapeHtml(phone)} and mention ${escapeHtml(partner.name)} or code ${escapeHtml(referralCode)}. Partner package: <a href="${escapeHtml(packageUrl)}">${escapeHtml(packageUrl)}</a>. Flyer: <a href="${escapeHtml(flyerUrl)}">${escapeHtml(flyer.label)}</a>.</p></div>
    </form>
  </main>
  <footer class="wrap footer">Saturn Star Movers · <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a> · <a href="tel:+1${phone.replace(/\\D/g, '')}">${escapeHtml(phone)}</a></footer>
  <script>
    const form = document.getElementById('quote-form');
    const success = document.getElementById('success');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      button.textContent = 'Submitting...';
      try {
        const res = await fetch('/partner/${encodeURIComponent(partner.code)}/referral?city=${encodeURIComponent(market.key)}', { method: 'POST', body: new FormData(form) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not submit quote request');
        success.textContent = data.message || 'Quote request received.';
        success.style.display = 'block';
        form.reset();
      } catch (error) {
        alert(error.message || 'Could not submit quote request. Please call or text Saturn Star Movers.');
      } finally {
        button.disabled = false;
        button.textContent = 'Request quote';
      }
    });
  </script>
</body>
</html>`)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'partner' && parts[1] === 'flyers') return serveAsset(request, env)
    if (parts[0] === 'quote') return renderQuotePage(request, env)
    if (parts[0] !== 'partner') return new Response('Not found', { status: 404 })

    const partner = partnerFromCode(parts[1] || 'partner')
    const market = detectMarket(url, parts[1] || '')
    if (parts[2] === 'referral') return handleReferral(request, env, partner, market)
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405)
    return renderPage(request, env, partner, market)
  },
}
