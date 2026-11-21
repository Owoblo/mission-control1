// Read-only candidate matching. Never merges organizations or enrolls outreach.
import { db, fs } from '../gta-email-recovery-runtime.mjs';

const input = 'artifacts/procurement-canadabuys-20261028/pattern-award-links.jsonl';
const output = 'artifacts/procurement-canadabuys-20261028/awardee-crm-candidates.json';
const awards = fs.readFileSync(input, 'utf8').trim().split('\n').map(JSON.parse);
const seeds = [
  ['Ottawa Moving Logistics 2013 Inc', 'Ottawa Moving Logistics'],
  ['D. Doyle Installations Limited', 'Doyle'],
  ['Royal Moving and Storage Inc.', 'Royal Moving'],
  ['Simplex Industries Inc.', 'Simplex'],
  ['Royal Moving & Storage (Ottawa) Inc.', 'Royal Moving'],
  ['Nattiq Inc.', 'Nattiq'],
  ['NATTIQ', 'Nattiq'],
];
const records = [];
for (const [awardee, token] of seeds) {
  const [companies, contacts] = await Promise.all([
    db('partner_companies', { company_name: `ilike.*${token}*`, select: 'id,company_name,normalized_key', limit: '1000' }),
    db('market_contacts', { company: `ilike.*${token}*`, select: 'id,company,email,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at', limit: '1000' }),
  ]);
  if (companies.length >= 1000 || contacts.length >= 1000) throw new Error(`Truncated CRM search: ${awardee}`);
  records.push({
    awardee, search_token: token,
    award_urls: awards.filter(a => a.awardee_reported === awardee).map(a => a.award_url),
    company_candidates: companies,
    contact_candidates: contacts.map(c => ({ id: c.id, company: c.company, has_email: !!c.email,
      suppression_flag: !!(c.do_not_contact || c.cross_channel_suppressed_at || c.email_unsubscribed_at) })),
    match_status: 'manual_identity_review_required', outreach_ready: false,
  });
}
fs.writeFileSync(output, JSON.stringify({ observed_at: new Date().toISOString(), records }, null, 2));
console.log(JSON.stringify({ records: records.length,
  company_candidate_rows: records.reduce((n, r) => n + r.company_candidates.length, 0),
  contact_candidate_rows: records.reduce((n, r) => n + r.contact_candidates.length, 0),
  outreach_ready: 0 }));
