import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
// Run against an isolated in-memory Postgres. Optional path supports a temporary install.
const { PGlite } = await import(
  process.env.PGLITE_TEST_MODULE || '@electric-sql/pglite'
)
test('atomic release, idempotent replay, handoffs, inbox limits and reply reconciliation', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      readFileSync(
        new URL('./partnership-seams-fixture.sql', import.meta.url),
        'utf8',
      ),
    )
    await db.exec(`
      alter table market_contacts add column email text,
        add column email_verification_status text, add column email_verification_provider text,
        add column email_verification_checked_at timestamptz,
        add column email_last_replied_at timestamptz, add column email_last_sent_at timestamptz;
      create table crm_tasks(status text, related_type text, related_id text);
      create table partner_referrals(company_id uuid, job_id text, job_status text);
    `)
    for (const migration of [
      '20260916000100_partnership_channel_policy',
      '20260916000300_reviewed_partnership_handoffs',
      '20260916001500_partnership_recipient_suppression_scope',
      '20261010000100_reviewed_nonresponse_email',
      '20261027000400_prepared_email_dispatch',
      '20261028000100_pilot_day3_followups',
      '20261119000100_prepared_sms_individual_realtors',
      '20261119000200_partnership_promotion_receipts',
      '20261119000300_partnership_handoff_cursor',
      '20261119000400_partnership_google_inbox_limits',
      '20261120000100_reviewed_realtor_sms_revivals',
      '20261120000200_approved_realtor_sms_dispatch',
    ]) {
      await db.exec(
        readFileSync(
          'supabase/migrations/' + migration + '.sql',
          'utf8',
        ),
      )
    }
    const row = {
      phone: '+15195551234',
      sender: '+15195551111',
      city: 'London',
      company: 'Example',
      contactName: 'Example Agent',
      body: 'Example',
      category: 'Realtor',
      execution_key: 'a'.repeat(64),
      scheduled_at: new Date(Date.now() + 600000).toISOString(),
      reviewReasons: [],
      lineage: {
        approved_by: 'test',
        artifact_path: 'research.json',
        artifact_recipient_id: 'agent',
        cleared_holds: [],
        original_holds: [],
      },
    }
    const promote = (r, campaign = 'example_batch') =>
      db.query(
        "select promote_research_sms($1,'Example',$2::jsonb,10) receipt",
        [campaign, JSON.stringify([r])],
      )
    await assert.rejects(promote({ ...row, lineage: {} }))
    assert.equal(
      (await db.query('select count(*) n from sequence_jobs')).rows[0].n,
      0,
    )
    const first = (await promote(row)).rows[0].receipt.jobs[0]
    assert.equal(first.replay, false)
    assert.equal((await promote(row)).rows[0].receipt.jobs[0].id, first.id)
    await assert.rejects(
      promote({
        ...row,
        execution_key: 'b'.repeat(64),
        lineage: { ...row.lineage, artifact_path: 'next-export.json' },
      }, 'next_export_batch'),
      /Recipient already queued or sent/,
    )
    assert.equal(
      (await db.query('select count(*) n from partnership_promotion_receipts')).rows[0].n,
      1,
    )
    await assert.rejects(
      promote({
        ...row,
        lineage: { ...row.lineage, approved_by: 'different' },
      }),
    )
    const [{ id }] = (await db.query('select id from market_contacts')).rows
    const [{ id: priorTouch }] = (await db.query(
      "insert into market_touches(contact_id,channel,direction,created_at) values($1,'sms','outbound',now()-interval '46 days') returning id",
      [id],
    )).rows
    const revival = {
      ...row,
      body: 'Reviewed revival',
      allow_revival: true,
      priorSmsTouchId: priorTouch,
      execution_key: createHash('sha256').update('prepared-sms-revival:' + priorTouch).digest('hex'),
      lineage: {
        ...row.lineage,
        prior_sms_touch_id: priorTouch,
        release_evidence: {
          method: 'approved_realtor_revival',
          source_url: 'https://example.test/agent',
          mobile: row.phone,
          content_hash: createHash('sha256').update('Reviewed revival').digest('hex'),
          carrier_checked_at: new Date(Date.now() - 1000).toISOString(),
          approved_by: row.lineage.approved_by,
          prior_sms_touch_id: priorTouch,
        },
      },
    }
    const revive = (r = revival) => promote(r, 'example_revival')
    await assert.rejects(revive(), /Recipient already queued or sent/)
    await db.query("update sequence_jobs set status='sent' where id=$1", [first.id])
    await db.query("update market_contacts set stage='dnc' where id=$1", [id])
    await assert.rejects(revive(), /Recipient suppressed or paused/)
    await db.query("update market_contacts set stage='target',sequence_paused=true where id=$1", [id])
    await assert.rejects(revive(), /Recipient suppressed or paused/)
    await db.query("update market_contacts set sequence_paused=false where id=$1", [id])
    await assert.rejects(revive({ ...revival, reviewReasons: ['copy_review'] }), /Incomplete revival release decision/)
    const next = (await revive()).rows[0].receipt.jobs[0]
    assert.equal(next.replay, false)
    assert.equal((await revive({ ...revival, allow_revival: undefined, allowRevival: true })).rows[0].receipt.jobs[0].id, next.id)
    const reserve = async (overrides = {}) => (await db.query(
      `select reserve_partnership_action($1,'sms','cold_introduction',$2,$3::jsonb) decision`,
      [id, 'sequence:' + next.id, JSON.stringify({
        allowRevival: true, marketActive: true, serviceAvailable: true, channelEligible: true,
        senderHealthy: true, observedAt: new Date().toISOString(), sender: revival.sender,
        contentHash: createHash('sha256').update(revival.body).digest('hex'), ...overrides,
      })],
    )).rows[0].decision
    assert.ok((await reserve()).reasons.includes('sms_revival_review_required'))
    await db.query("update sequence_jobs set status='running' where id=$1", [next.id])
    assert.ok((await reserve({ allowRevival: false })).reasons.includes('existing_contact_outreach_review'))
    assert.ok((await reserve({ contentHash: 'wrong' })).reasons.includes('sms_revival_review_required'))
    await db.query("update market_contacts set do_not_contact=true where id=$1", [id])
    assert.ok((await reserve()).reasons.includes('recipient_suppressed'))
    await db.query("update market_contacts set do_not_contact=false,sequence_paused=true where id=$1", [id])
    assert.ok((await reserve()).reasons.includes('sms_revival_review_required'))
    await db.query("update market_contacts set sequence_paused=false where id=$1", [id])
    await db.query("insert into partnership_account_policy(account_id,unresolved_promise,evidence_ref) select partner_company_id,true,'fixture' from market_contacts where id=$1", [id])
    assert.ok((await reserve()).reasons.includes('relationship_work_pending'))
    await db.exec("update partnership_account_policy set unresolved_promise=false")
    const [{ id: newerTouch }] = (await db.query(
      "insert into market_touches(contact_id,channel,direction,created_at) values($1,'sms','outbound',now()) returning id",
      [id],
    )).rows
    assert.ok((await reserve()).reasons.includes('sms_revival_review_required'))
    await db.query('delete from market_touches where id=$1', [newerTouch])
    assert.equal((await reserve()).allowed, true)
    assert.ok((await reserve()).reasons.includes('existing_reservation_inspect_before_retry'))
    await db.query("update sequence_jobs set status='pending' where id=$1", [next.id])
    await db.query(
      "insert into market_touches(contact_id,channel,direction,created_at) values($1,'sms','inbound',now()-interval '1 hour')",
      [id],
    )
    assert.equal(
      (await db.query('select count(*) n from partnership_handoff_arrivals'))
        .rows[0].n,
      1,
    )
    const lead = () =>
      db.query("select create_partnership_handoff('sample',$1,$2) created", [
        id,
        JSON.stringify({
          email: 'sample@example.test',
          partnerLeadPriority: 'high',
        }),
      ])
    assert.equal((await lead()).rows[0].created, true)
    assert.equal((await lead()).rows[0].created, false)
    await db.exec(
      "insert into google_mail_connections values('inbox','connected',true); insert into partnership_google_routes values('inbox',1,now()-interval '15 days',now(),now(),true)",
    )
    const slot = (key) =>
      db.query(
        "select claim_partnership_google_slot('inbox',$1,$2,'test@example.test')",
        [key, id],
      )
    await slot('first')
    await assert.rejects(slot('second'))
    await db.exec("update partnership_google_slots set thread_id='thread'")
    const reply = () =>
      db.query(
        "select record_partnership_google_reply('first','msg','test@example.test','STOP',now(),'11111111-1111-1111-1111-111111111111',true)",
      )
    await reply()
    await reply()
    assert.equal(
      (
        await db.query(
          "select count(*) n from market_touches where channel='email'",
        )
      ).rows[0].n,
      1,
    )
    assert.equal(
      (await db.query('select status from sequence_jobs where id=$1', [next.id])).rows[0].status,
      'cancelled',
    )
  } finally {
    await db.close()
  }
})
