import { timingSafeEqual } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { NextResponse } from 'next/server'
import { prepareOpenHouseSmsPromotion } from '@/lib/server/open-house-sms-promotion'
import { prepareGeoSmsPromotion } from '@/lib/server/geo-sms-promotion'
import { promoteResearchSms } from '@/lib/server/research-sms-promoter'
import { getWorkerSharedSecret, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const supplied = Buffer.from(request.headers.get('x-internal-secret') || '')
  const expected = Buffer.from(getWorkerSharedSecret())
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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
    return NextResponse.json({ error: 'Invalid promotion batch or evidence unavailable' }, { status: 400 })
  }
  const enabled = readEnv('PREPARED_SMS_EXECUTION_ENABLED') === 'true' &&
    readEnv(openHouse ? 'PARTNERSHIP_OPEN_HOUSE_SMS_AUTO_PROMOTION_ENABLED' : 'PARTNERSHIP_GEO_SMS_AUTO_PROMOTION_ENABLED') === 'true'
  if (prepared.options.execute && !enabled) {
    return NextResponse.json({ error: 'Geography SMS promotion disabled' }, { status: 409 })
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
