#!/usr/bin/env node
// Moves only root inbound MX from the suspended Google Workspace to Zoho Canada.
// SES custom MAIL FROM uses bounce.saturnstarmovers.ca and is never touched.
import fs from 'node:fs';

process.loadEnvFile('.env.cloudflare.local');
const token = process.env.CLOUDFLARE_API_TOKEN;
const domain = 'saturnstarmovers.ca';
const desired = [
  { content: 'mx.zohocloud.ca', priority: 10 },
  { content: 'mx2.zohocloud.ca', priority: 20 },
  { content: 'mx3.zohocloud.ca', priority: 50 },
];
const oldHosts = new Set([
  'aspmx.l.google.com', 'alt1.aspmx.l.google.com', 'alt2.aspmx.l.google.com',
  'alt3.aspmx.l.google.com', 'alt4.aspmx.l.google.com',
]);
const normalize = value => String(value || '').toLowerCase().replace(/\.$/, '');
if (!token) throw new Error('Missing Cloudflare token');

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(data.errors || [])}`);
  return data.result;
}

const zone = (await cf(`/zones?name=${domain}`))?.[0];
if (!zone?.id || normalize(zone.name) !== domain) throw new Error('Cloudflare zone mismatch');
const path = `/zones/${zone.id}/dns_records`;
async function mx() {
  const all = await cf(`${path}?type=MX&name=${domain}&per_page=100`);
  return all.filter(r => normalize(r.name) === domain);
}
const before = await mx();
const allowed = new Set([...oldHosts, ...desired.map(r => r.content)]);
if (before.some(r => !allowed.has(normalize(r.content)))) throw new Error('Unexpected root MX; no changes made');
const summary = records => records.map(r => ({ host: normalize(r.content), priority: r.priority }));
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ before: summary(before), desired, note: 'Dry run; no DNS changes' }, null, 2));
  process.exit(0);
}

fs.mkdirSync('artifacts', { recursive: true });
const backup = `artifacts/saturn-root-mx-before-zoho-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(backup, JSON.stringify({ domain, at: new Date().toISOString(), mx: summary(before) }, null, 2));
for (const wanted of desired) {
  if (before.some(r => normalize(r.content) === wanted.content && r.priority === wanted.priority)) continue;
  await cf(path, {
    method: 'POST',
    body: JSON.stringify({ type: 'MX', name: domain, content: wanted.content, priority: wanted.priority, ttl: 300, comment: 'Zoho Canada inbound mail' }),
  });
}
const staged = await mx();
if (!desired.every(w => staged.some(r => normalize(r.content) === w.content && r.priority === w.priority))) {
  throw new Error('Zoho MX staging incomplete; Google MX retained');
}
for (const record of staged.filter(r => oldHosts.has(normalize(r.content)))) {
  await cf(`${path}/${record.id}`, { method: 'DELETE' });
}
const after = await mx();
if (after.length !== 3 || !desired.every(w => after.some(r => normalize(r.content) === w.content && r.priority === w.priority))) {
  throw new Error(`Final root MX differs from desired: ${JSON.stringify(summary(after))}`);
}
console.log(JSON.stringify({ backup, after: summary(after), changed: true, note: 'Only root MX records changed' }, null, 2));
