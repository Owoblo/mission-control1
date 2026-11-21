#!/usr/bin/env node
// Add Zoho Canada to the existing root SPF without touching SES's bounce SPF.
process.loadEnvFile('.env.cloudflare.local');
const token = process.env.CLOUDFLARE_API_TOKEN;
const domain = 'saturnstarmovers.ca';
const beforeValue = 'v=spf1 include:_spf.google.com ~all';
const afterValue = 'v=spf1 include:_spf.google.com include:zohocloud.ca ~all';
if (!token) throw new Error('Missing Cloudflare API token');
async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(result.errors || [])}`);
  return result.result;
}
const zone = (await cf(`/zones?name=${domain}`))?.[0];
if (zone?.name !== domain || !zone.id) throw new Error('Zone mismatch');
const path = `/zones/${zone.id}/dns_records`;
async function rootSpf() {
  return (await cf(`${path}?type=TXT&name=${domain}&per_page=100`))
    .filter(r => r.name === domain && r.content.replace(/^"|"$/g, '').toLowerCase().startsWith('v=spf1'));
}
const current = await rootSpf();
const value = current[0]?.content.replace(/^"|"$/g, '');
if (current.length !== 1 || ![beforeValue, afterValue].includes(value)) {
  throw new Error(`Unexpected root SPF state: ${JSON.stringify(current.map(r => r.content))}`);
}
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ before: value, after: afterValue, note: 'Dry run' }, null, 2));
  process.exit(0);
}
if (value !== afterValue) {
  await cf(`${path}/${current[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: afterValue, comment: 'Zoho Canada plus existing Google SPF; SES bounce SPF is separate' }),
  });
}
const verified = await rootSpf();
if (verified.length !== 1 || verified[0].content.replace(/^"|"$/g, '') !== afterValue) throw new Error('SPF verification failed');
console.log(JSON.stringify({ after: verified[0].content, note: 'Only root SPF changed' }, null, 2));
