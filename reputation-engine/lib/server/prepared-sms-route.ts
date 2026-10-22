import { NextResponse } from 'next/server'
import { enqueuePreparedSms, type PreparedSms, type CrmRow } from './prepared-sms'
import { readCompleteRest } from './read-complete-rest'
import { readEnv, requireSupabaseEnv } from './runtime'

export async function handlePreparedSms(body: { name?: string; prepared_rows: PreparedSms[]; campaign_key?: string; daily_cap?: number; dry_run?: boolean; approved?: boolean }) {
  if (!body.campaign_key || !/^[a-zA-Z0-9:_-]{8,160}$/.test(body.campaign_key) || !body.name?.trim() || !Array.isArray(body.prepared_rows) || !body.prepared_rows.length || body.prepared_rows.length > 1000) return NextResponse.json({ error: 'Invalid prepared campaign' }, { status: 400 })
  if (body.prepared_rows.some(r => ['phone','company','city','category','body','sender'].some(k => typeof r[k as keyof PreparedSms] !== 'string') || (r.reviewReasons !== undefined && (!Array.isArray(r.reviewReasons) || r.reviewReasons.some(v => typeof v !== 'string'))))) return NextResponse.json({ error: 'Invalid prepared recipient' }, { status: 400 })
  if (body.dry_run === false && (body.approved !== true || readEnv('PREPARED_SMS_EXECUTION_ENABLED') !== 'true')) return NextResponse.json({ error: 'Prepared SMS execution disabled or campaign not approved' }, { status: 409 })
  const db = requireSupabaseEnv()
  const [contacts, touches, jobs] = await Promise.all([
    readCompleteRest<CrmRow>(`${db.url}/rest/v1/market_contacts?select=*`, db.headers),
    readCompleteRest<CrmRow>(`${db.url}/rest/v1/market_touches?select=id,contact_id,direction&direction=eq.outbound`, db.headers),
    readCompleteRest<CrmRow>(`${db.url}/rest/v1/sequence_jobs?select=*`, db.headers),
  ])
  const result = await enqueuePreparedSms({ campaignKey: body.campaign_key, name: body.name, rows: body.prepared_rows, snapshot: { contacts, touches, jobs }, dailyCap: body.daily_cap, approved: body.approved, dryRun: body.dry_run, executionEnabled: readEnv('PREPARED_SMS_EXECUTION_ENABLED') === 'true' }, db)
  return NextResponse.json(result)
}
