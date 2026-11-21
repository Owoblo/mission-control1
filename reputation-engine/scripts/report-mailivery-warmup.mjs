import fs from 'node:fs';
import crypto from 'node:crypto';

const keyFile = new URL('../.env.mailivery.local', import.meta.url);
const line = fs.readFileSync(keyFile, 'utf8').split('\n').find((entry) => entry.startsWith('MAILIVERY_API_KEY='));
if (!line) throw new Error('Missing MAILIVERY_API_KEY in .env.mailivery.local');
const key = line.slice('MAILIVERY_API_KEY='.length);
const base = 'https://app.mailivery.io/api/v1';
const tracked = new Set([
  'john@saturnstarmovers.ca',
  'johnny@saturnstarmovers.ca',
  'jhon@saturnstarmovers.ca',
]);

async function request(path, method = 'GET') {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'X-Request-ID': crypto.randomUUID(),
    },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}: ${payload.message ?? 'unknown error'}`);
  return payload.data ?? payload;
}

const campaigns = await request('/campaigns?per_page=100&include_connection_details=true');
const rows = Array.isArray(campaigns) ? campaigns : campaigns.data;
if (!Array.isArray(rows)) throw new Error('Unexpected Mailivery campaign response');
const limits = await request('/account/limits');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const report = {
  checkedAt: new Date().toISOString(),
  dateToronto: today,
  account: {
    warmupDailyPool: limits.email_per_day ?? null,
    emailAccounts: limits.email_accounts ?? null,
    emailsSentToday: limits.emails_sent_today ?? null,
  },
  mailboxes: [],
  warnings: [],
};

for (const row of rows.filter((item) => tracked.has(item.email))) {
  const [metrics, health, points] = await Promise.all([
    request(`/campaigns/${row.id}/get-metrics`, 'PATCH'),
    request(`/campaigns/${row.id}/get-health-score`, 'PATCH'),
    request(`/campaigns/${row.id}/get-health-score-points`, 'PATCH'),
  ]);
  const daily = metrics[today] ?? {};
  report.mailboxes.push({
    email: row.email,
    id: row.id,
    status: row.status_code,
    smtpHost: row.smtp?.host ?? row.smtp?.smtp_host ?? null,
    imapHost: row.imap?.host ?? row.imap?.imap_host ?? null,
    targetPerDay: row.email_per_day,
    responseRate: row.response_rate,
    rampUp: row.ramp_up,
    scheduledToday: row.scheduled_for_today,
    sentToday: row.emails_sent_today,
    warmupSentToday: daily['Warm Up']?.Total ?? null,
    warmupLandedIn: Array.isArray(daily['Warm Up']?.['Landed In']) ? {} : (daily['Warm Up']?.['Landed In'] ?? {}),
    warmupRepliesReceivedToday: daily['Received Replies']?.Total ?? null,
    spamRateLast14Days: Number(row.spam_rate_in_last_14_days) < 0 ? null : (row.spam_rate_in_last_14_days ?? null),
    health: {
      grade: health.grade ?? null,
      dnsGrade: health.dns_grade ?? null,
      spf: health.spf ?? null,
      dmarc: health.dmarc ?? null,
      mx: health.mx ?? null,
      warmupDurationDays: health.warmup_duration_days ?? null,
      score: points.health_score ?? null,
      scoreStatus: points.health_score_status ?? null,
    },
  });
  const smtpHost = row.smtp?.host ?? row.smtp?.smtp_host;
  if (smtpHost !== 'email-smtp.us-east-2.amazonaws.com') report.warnings.push(`${row.email}: expected SES us-east-2 SMTP path is not confirmed`);
  const failedReads = Number(daily['Warm Up']?.['Landed In']?.['*FAILED_TO_READ*'] ?? 0);
  const spam = Number(daily['Warm Up']?.['Landed In']?.spam ?? 0);
  if (spam > 0) report.warnings.push(`${row.email}: ${spam} warm-up messages reported in Spam; DNS grade is not inbox placement evidence`);
  if (failedReads > 0) report.warnings.push(`${row.email}: ${failedReads} warm-up placements could not be read; investigate before treating its grade as placement evidence`);
  if (row.status_code !== 'active') report.warnings.push(`${row.email}: warm-up status is ${row.status_code}`);
}
for (const email of tracked) if (!report.mailboxes.some(row => row.email === email)) report.warnings.push(`${email}: missing from the campaign response; warm-up cannot be confirmed`);
report.mailboxes.sort((a, b) => a.email.localeCompare(b.email));
if (process.argv.includes('--save')) {
  const directory = new URL('../artifacts/mailivery-warmup/', import.meta.url);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(new URL(`${today}.json`, directory), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
