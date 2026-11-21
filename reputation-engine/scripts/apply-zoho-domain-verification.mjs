#!/usr/bin/env node
// Adds only Zoho's ownership TXT. It never changes MX, SPF, DKIM or SES records.
process.loadEnvFile('.env.cloudflare.local');

const domain = 'saturnstarmovers.ca';
const content = 'zoho-verification=zb90791629.zmverify.zohocloud.ca';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Missing Cloudflare API token');

async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare request failed: ${response.status} ${JSON.stringify(data.errors || [])}`);
  return data.result;
}

const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`);
const zoneId = zones?.[0]?.id;
if (!zoneId) throw new Error('Cloudflare zone not found');
const records = await cf(`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(domain)}&per_page=100`);
if (records.some(record => record.content.replace(/^"|"$/g, '') === content)) {
  console.log('Zoho verification TXT already exists. MX unchanged.');
} else if (process.argv.includes('--apply')) {
  await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify({ type: 'TXT', name: domain, content, ttl: 300, comment: 'Zoho Mail ownership verification; does not route mail' }),
  });
  console.log('Added Zoho verification TXT. MX unchanged.');
} else {
  console.log(`Ready to add TXT ${domain}: ${content}. Run with --apply to create it; MX will remain unchanged.`);
}
