import fs from 'node:fs';
import {parseEnv} from 'node:util';

// Read-only reporting. Never fetch or persist mailbox passwords.
export async function readScaledMailHealth() {
  const env=parseEnv(fs.readFileSync(new URL('../.env.scaledmail.local',import.meta.url),'utf8'));
  async function get(endpoint) {
    const response=await fetch(`https://server.scaledmail.com/api/v1/${endpoint}`,{
      headers:{Authorization:`Bearer ${env.SCALEDMAIL_API_KEY}`,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(20000),
    });
    if(!response.ok)throw new Error(`ScaledMail HTTP ${response.status}`);
    return response.json();
  }
  const workspace='org_ZAKVwnnfk1PE';
  const data=await get(`reporting?organization_id=${workspace}`);
  if(!Array.isArray(data.reports))throw new Error('Invalid ScaledMail reporting response');
  const reports=data.reports.map(r=>({week:r.weekof,status:r.status,inboxScore:r.avgInboxScore,
    domains:(r.domains??[]).map(d=>({domain:d.domain_name,inboxScore:d.stats?.overall_score,
      reputation:d.stats?.domain_reputation,blacklisted:d.stats?.blacklisted??[]}))}));
  return {checkedAt:new Date().toISOString(),workspace,total:data.total,reports,
    nextPageAvailable:Boolean(data.next_before),
    note:reports.length?'Completed weekly tests; not real-time delivery results.':'No completed reports. Subscription activation is not established by this endpoint.'};
}
