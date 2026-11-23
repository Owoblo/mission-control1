import { timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { prepareOpenHouseSmsPromotion } from '@/lib/server/open-house-sms-promotion'
import { prepareGeoSmsPromotion } from '@/lib/server/geo-sms-promotion'
import { promoteResearchSms } from '@/lib/server/research-sms-promoter'
import { getWorkerSharedSecret, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const geoFlag = 'PARTNERSHIP_GEO_SMS_AUTO_PROMOTION_ENABLED'
const realtorFlag = 'PARTNERSHIP_OPEN_HOUSE_SMS_AUTO_PROMOTION_ENABLED'

function authorized(request: Request) {
  const supplied = Buffer.from(request.headers.get('x-internal-secret') || '')
  const expected = Buffer.from(getWorkerSharedSecret())
  return expected.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function executionEnabled(flag: string) {
  return readEnv('PREPARED_SMS_EXECUTION_ENABLED') === 'true' && readEnv(flag) === 'true'
}

export function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    contract: 'research_sms_promotion_v1',
    lanes: {
      geo_b2b_intro_v1: { execution_enabled: executionEnabled(geoFlag) },
      open_house_realtor_v1: { execution_enabled: executionEnabled(realtorFlag) },
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let prepared
  let db
  let openHouse = false
  try {
    const wire = await request.json()
    let batch = wire
    if (wire?.encoding === 'gzip-base64') {
      if (typeof wire.data !== 'string' || wire.data.length > 4 * 1024 * 1024) throw new Error('Invalid compressed batch')
      const json = gunzipSync(Buffer.from(wire.data, 'base64'), { maxOutputLength: 32 * 1024 * 1024 })
      batch = JSON.parse(json.toString('utf8'))
    }
    db = requireSupabaseEnv()
    openHouse = batch?.draft_version === 'open_house_realtor_v1'
    prepared = openHouse ? await prepareOpenHouseSmsPromotion(batch, db) : prepareGeoSmsPromotion(batch)
  } catch {
    return NextResponse.json({ error: 'Invalid promotion batch or evidence unavailable',
      code: openHouse ? 'invalid_realtor_batch_or_evidence' : 'invalid_b2b_batch' }, { status: 400 })
  }
  const flag = openHouse ? realtorFlag : geoFlag
  const enabled = executionEnabled(flag)
  if (prepared.options.execute && !enabled) {
    return NextResponse.json({ error: 'Automated SMS promotion disabled', code: 'execution_disabled',
      required_flags: ['PREPARED_SMS_EXECUTION_ENABLED', flag].filter(name => readEnv(name) !== 'true') }, { status: 409 })
  }
  try {
    const report = await promoteResearchSms(prepared.rows, prepared.options, db, enabled)
    const idsByPhone = new Map(prepared.rows.map(row => [row.phone, row.lineage.artifact_recipient_id]))
    return NextResponse.json({
      campaign_key: prepared.options.campaignKey,
      prepared: report.prepared,
      send_ready: report.send_ready,
      would_queue: report.would_queue,
      already_queued: report.already_queued,
      scheduled: 'scheduled' in report ? report.scheduled : 0,
      held: report.blocked.map(row => ({
        id: idsByPhone.get(row.phone) ?? null,
        reasons: row.reasons,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Promotion not confirmed; reconcile the campaign before retrying' }, { status: 503 })
  }
}
