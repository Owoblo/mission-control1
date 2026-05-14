const { test, expect } = require('@playwright/test');
const fs = require('fs');

const baseUrl = 'https://mission-control1-reputation-engine.vercel.app';
const envPath = '/tmp/mission-control1-production.raw.env';

function loadEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx);
    let value = line.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.endsWith('\\n')) value = value.slice(0, -2);
    values[key] = value;
  }
  return values;
}

const env = loadEnv(envPath);
const authPassword = env.AUTH_PASSWORD;
const supabaseUrl = env.SUPABASE_URL;
const supabaseKey = env.SUPABASE_KEY;

test.use({
  browserName: 'chromium',
});

async function supabase(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, text, json };
}

async function waitForLeadByCallSid(callSid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const mapping = await supabase(`crm_call_sids?select=call_sid,lead_id&call_sid=eq.${encodeURIComponent(callSid)}`);
    if (Array.isArray(mapping.json) && mapping.json[0]?.lead_id) {
      return mapping.json[0].lead_id;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for lead for ${callSid}`);
}

async function getLeadRow(leadId) {
  const leadRow = await supabase(`crm_leads?select=id,data&id=eq.${encodeURIComponent(leadId)}&limit=1`);
  return Array.isArray(leadRow.json) ? leadRow.json[0] : null;
}

async function getQuoteRow(quoteId) {
  const quoteRow = await supabase(`crm_quotes?select=id,data&id=eq.${encodeURIComponent(quoteId)}&limit=1`);
  return Array.isArray(quoteRow.json) ? quoteRow.json[0] : null;
}

test('production live feed, inbox, and estimate builder stay aligned', async ({ page, request }) => {
  test.setTimeout(180000);
  page.on('pageerror', error => {
    console.log(`PAGEERROR: ${error.stack || error.message}`);
  });
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`CONSOLE[${msg.type()}]: ${msg.text()}`);
    }
  });

  const runSuffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-8);
  const phone = `+1519555${runSuffix.slice(-4)}`;
  const callSid = `MC_UI_QA_${runSuffix}`;

  let leadId = '';
  let inboundId = '';
  let quoteId = '';
  let clientId = '';

  try {
    const loginRes = await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    expect(loginRes && loginRes.ok()).toBeTruthy();

    await page.locator('input[type="password"]').fill(authPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/sales$/, { timeout: 30000 });

    const twiml = await request.fetch(`${baseUrl}/api/sales/dialer/twiml`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: `To=%2B12267732993&From=${encodeURIComponent(phone)}&Direction=inbound&CallSid=${encodeURIComponent(callSid)}`,
    });
    expect(twiml.ok()).toBeTruthy();

    leadId = await waitForLeadByCallSid(callSid);
    const seededLead = await getLeadRow(leadId);
    inboundId = seededLead?.data?.inboundId || '';
    expect(inboundId).toBeTruthy();

    await page.goto(`${baseUrl}/sales`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Live Feed' })).toBeVisible();
    await expect(page.getByText(`Incoming call from ${phone}`).first()).toBeVisible({ timeout: 15000 });

    await page.goto(`${baseUrl}/sales/inbox`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Lead Inbox' })).toBeVisible();
    await expect(page.getByText('Inbound Call').first()).toBeVisible();
    await expect(page.getByText('New Caller').first()).toBeVisible();
    await expect(page.getByText(phone).first()).toBeVisible();

    const patchResult = await page.evaluate(async ({ leadId, phone, runSuffix }) => {
      const inventory = [
        { name: 'Samsung TV', item: 'Samsung TV', room: 'Living Room', qty: 1, cubicFeet: 18, weightLbs: 55, included: true },
        { name: 'Dining Table', item: 'Dining Table', room: 'Dining Room', qty: 1, cubicFeet: 45, weightLbs: 120, included: true },
        { name: 'Patio Set', item: 'Patio Set', room: 'Outdoor', qty: 1, cubicFeet: 55, weightLbs: 95, included: true },
        { name: 'Office Table', item: 'Office Table', room: 'Office', qty: 1, cubicFeet: 28, weightLbs: 70, included: true },
      ];

      const response = await fetch(`/api/sales/leads/${leadId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `UI QA ${runSuffix}`,
          phone,
          source: 'twilio_call',
          moveType: 'residential',
          branch: 'windsor',
          originAddress: '171 Ouellette Ave',
          originCity: 'Windsor',
          destAddress: '300 Chatham St W',
          destCity: 'Windsor',
          notes: 'Synthetic UI QA lead for dashboard, inbox, and estimate builder validation.',
          inventory,
          totalItems: inventory.reduce((sum, item) => sum + (item.qty || 1), 0),
          totalCubicFeet: inventory.reduce((sum, item) => sum + ((item.cubicFeet || 0) * (item.qty || 1)), 0),
          totalWeightLbs: inventory.reduce((sum, item) => sum + ((item.weightLbs || 0) * (item.qty || 1)), 0),
        }),
      });
      const json = await response.json().catch(() => null);
      return { ok: response.ok, json };
    }, { leadId, phone, runSuffix });

    expect(patchResult.ok).toBeTruthy();

    await page.goto(`${baseUrl}/sales/leads/${leadId}`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Inventory + Scope')).toBeVisible();
    await expect(page.getByRole('heading', { name: `UI QA ${runSuffix}` }).first()).toBeVisible();

    const createQuoteResult = await page.evaluate(async ({ leadId }) => {
      const response = await fetch('/api/sales/quotes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      });
      const json = await response.json().catch(() => null);
      return { ok: response.ok, json };
    }, { leadId });

    expect(createQuoteResult.ok).toBeTruthy();

    await page.goto(`${baseUrl}/sales/leads/${leadId}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Build Estimate' }).click();

    const modal = page.locator('div').filter({ hasText: 'Estimate Draft' }).first();
    await expect(modal.getByText('Estimate Draft')).toBeVisible({ timeout: 30000 });
    await expect(modal.getByText('Branch / Yard Origin')).toBeVisible();
    await expect(modal.getByText('Manual Billable KM Override')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Windsor' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Waterloo / KW' })).toBeVisible();

    const tvProtection = modal.locator('div').filter({ hasText: 'TV Protection' }).first();
    await expect(tvProtection.getByText('Samsung TV').first()).toBeVisible();
    await expect(tvProtection.getByText('Avg 55"').first()).toBeVisible();
    await expect(tvProtection.getByText(/TV Box .*55.*65/).first()).toBeVisible();

    const scopeSection = modal.locator('div').filter({ hasText: 'Inner — On-site Scope' }).first();
    await expect(scopeSection.getByText(/Disassembly \+ reassembly \(1 of 1 items\)/)).toBeVisible();
    await expect(scopeSection.getByText('Dining Table').first()).toBeVisible();
    await expect(scopeSection.getByText('Patio Set')).toHaveCount(0);
    await expect(scopeSection.getByText('Office Table')).toHaveCount(0);

    await modal.getByRole('button', { name: 'Waterloo / KW' }).click();
    await expect(modal.getByText('Sets which Saturn Star yard is used as the drive origin.')).toBeVisible();

    const overrideInput = modal
      .locator('label:has-text("Manual Billable KM Override")')
      .locator('xpath=following-sibling::input[1]');
    await overrideInput.fill('42');
    await expect(overrideInput).toHaveValue('42');

    await page.screenshot({ path: '/tmp/mission-control1-ui-qa.png', fullPage: true });

    const refreshedLead = await getLeadRow(leadId);
    quoteId = refreshedLead?.data?.quoteId || '';
    expect(quoteId).toBeTruthy();

    const quoteRow = await getQuoteRow(quoteId);
    clientId = quoteRow?.data?.clientId || '';
  } finally {
    if (quoteId) {
      await supabase(`crm_quotes?id=eq.${encodeURIComponent(quoteId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      await supabase(`crm_followup_logs?data->>quoteId=eq.${encodeURIComponent(quoteId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }

    if (clientId) {
      await supabase(`crm_clients?id=eq.${encodeURIComponent(clientId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }

    if (leadId) {
      await supabase(`crm_followup_logs?data->>leadId=eq.${encodeURIComponent(leadId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      await supabase(`crm_leads?id=eq.${encodeURIComponent(leadId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }

    if (inboundId) {
      await supabase(`inbound_leads?id=eq.${encodeURIComponent(inboundId)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    }

    await supabase(`crm_call_sids?call_sid=eq.${encodeURIComponent(callSid)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
  }
});
