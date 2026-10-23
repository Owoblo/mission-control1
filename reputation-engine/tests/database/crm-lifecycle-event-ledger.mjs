import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('lead and quote lifecycle history is transactional, append-only, and avoids message/payment secrets', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table analytics_events(id text primary key, event_type text not null, lead_id text, rep_id text, ts timestamptz, properties jsonb not null default '{}'::jsonb, created_at timestamptz default now());
      create table crm_leads(id text primary key, data jsonb not null, updated_at timestamptz default now(), deleted boolean default false);
      create table crm_quotes(id text primary key, data jsonb not null, updated_at timestamptz default now(), deleted boolean default false);
      create table crm_followup_logs(id text primary key, data jsonb not null, updated_at timestamptz default now(), deleted boolean default false);
      create table job_outcomes(id text primary key, lead_id text, quote_id text, rep_id text, move_date date, estimated_hours numeric, actual_hours numeric, actual_crew integer, revenue_cents bigint, total_costs_cents bigint, net_profit_cents bigint, margin_pct numeric, damage_flag boolean, customer_rating integer, review_left boolean, referral_generated boolean, notes text, created_at timestamptz default now(), updated_at timestamptz default now());
      create table job_costs(id text primary key, lead_id text, category text, description text, amount_cents bigint, cost_date date, created_by text);
      insert into crm_leads(id,data) values ('LEGACY', '{"id":"LEGACY","stage":"booked","source":"partner_referral","attribution":{"utmCampaign":"old","sourceUrl":"https://example.test/?email=private@example.test"}}');
      insert into crm_quotes(id,data) values ('LEGACY-Q', '{"id":"LEGACY-Q","leadId":"LEGACY","status":"accepted","total":100,"paymentRecords":[{"id":"p-old","kind":"deposit","amount":100,"paidAt":"2026-10-01T12:00:00Z","status":"captured","cardLast4":"4321","token":"old-secret"}]}');
      insert into crm_followup_logs(id,data) values ('LEGACY-F','{"id":"LEGACY-F","leadId":"LEGACY","type":"sms","date":"2026-10-01T12:00:00Z","notes":"private customer message"}');
      insert into job_outcomes(id,lead_id,quote_id,actual_hours,total_costs_cents,net_profit_cents) values ('LEGACY-O','LEGACY','LEGACY-Q',4,5000,5000);
      insert into job_costs(id,lead_id,category,amount_cents,cost_date,created_by) values ('LEGACY-C','LEGACY','labor',5000,'2026-10-01','rep-1');
    `)
    await db.exec(await readFile('supabase/migrations/20261021000100_crm_lifecycle_event_ledger.sql', 'utf8'))

    const baselines = (await db.query(`select event_type, source, after_values from crm_lifecycle_events where event_key like 'baseline:%'`)).rows
    for (const eventType of ['lead_baseline', 'quote_baseline', 'job_outcome_baseline', 'job_cost_baseline', 'followup_baseline']) {
      assert.ok(baselines.some(row => row.event_type === eventType && row.source === 'migration_baseline'), `expected ${eventType} baseline`)
    }
    assert.ok(!JSON.stringify(baselines).includes('private@example.test'), 'baseline attribution excludes URLs that may contain personal query parameters')
    assert.ok(JSON.stringify(baselines).includes('p-old'), 'baseline includes safe existing payment records')
    assert.ok(!JSON.stringify(baselines).includes('old-secret'))
    assert.ok(!JSON.stringify(baselines).includes('4321'))
    assert.ok(!JSON.stringify(baselines).includes('private customer message'))

    await db.query(`insert into crm_leads(id,data) values($1,$2)`, ['L-1', {
      id: 'L-1', stage: 'new', source: 'website', commercialDisposition: 'qualified_lead',
      assignedRepUserId: 'rep-1', assignedRepName: 'Rep One', lastTouchedByUserId: 'owner-1', lastTouchedByName: 'Owner',
      originCity: 'Windsor', destCity: 'London', moveType: 'residential', inventory: [{ name: 'Sofa' }],
      callLogs: [], attribution: { originalSource: 'website', utmCampaign: 'spring', gclid: 'click-1', sourceUrl: 'https://example.test/?email=private@example.test' },
    }])
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where event_type='lead_created'`)).rows[0].count, 1)

    await db.query(`insert into crm_followup_logs(id,data) values($1,$2)`, ['F-1', {
      id: 'F-1', leadId: 'L-1', quoteId: 'Q-1', type: 'sms', date: '2026-10-21T13:04:00Z',
      notes: 'sensitive reply text', aiSummary: { summary: 'private summary' },
    }])
    const followupRow = (await db.query(`select * from crm_lifecycle_events where entity_id='F-1' and event_type='followup_recorded'`)).rows[0]
    assert.equal(followupRow.after_values.type, 'sms')
    assert.equal(followupRow.after_values.noteLength, 20)
    assert.ok(!JSON.stringify(followupRow).includes('sensitive reply text'))
    assert.ok(!JSON.stringify(followupRow).includes('private summary'))
    await db.query(`update crm_followup_logs set data=jsonb_set(data,'{type}','"email"') where id='F-1'`)
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where entity_id='F-1' and event_type='followup_revised'`)).rows[0].count, 1)
    await db.query(`update crm_followup_logs set data=jsonb_set(data,'{notes}','"another private reply"') where id='F-1'`)
    const followupRevisions = (await db.query(`select * from crm_lifecycle_events where entity_id='F-1' and event_type='followup_revised'`)).rows
    assert.equal(followupRevisions.length, 2, 'private note edits are timestamped without recording their content')
    assert.ok(followupRevisions.some(row => row.properties.privateNoteChanged === true))
    assert.ok(!JSON.stringify(followupRevisions).includes('another private reply'))
    await db.query(`delete from crm_followup_logs where id='F-1'`)
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where entity_id='F-1' and event_type='followup_deleted'`)).rows[0].count, 1)

    await db.query(`insert into analytics_events(id,event_type,lead_id,rep_id,ts,properties) values($1,$2,$3,$4,$5,$6)`, [
      'ev_callleg_CA123_answered_1', 'telephony_call_leg_event', 'L-1', 'rep-1', '2026-10-21T13:01:00Z', {
        event: 'answered', direction: 'inbound', workspace: 'sales', identity: 'saturn-rep-rep-1',
        parentCallSid: 'CA-parent', childCallSid: 'CA123', callDurationSeconds: 47,
        answerTimeSeconds: 9, answerTimeMethod: 'provider_leg_answer_timestamp', repName: 'Rep One',
        transcript: 'private voice transcript', recordingUrl: 'https://private.test/recording', callerNumber: '+15555550123',
      },
    ])
    const telephonyLedger = (await db.query(`select * from crm_lifecycle_events where event_key='analytics:ev_callleg_CA123_answered_1'`)).rows
    assert.equal(telephonyLedger.length, 1, 'provider callbacks are copied into the durable ledger')
    assert.equal(telephonyLedger[0].entity_type, 'call')
    assert.equal(telephonyLedger[0].after_values.answerLatencySeconds, 9)
    const serializedTelephonyLedger = JSON.stringify(telephonyLedger)
    assert.ok(!serializedTelephonyLedger.includes('private voice transcript'))
    assert.ok(!serializedTelephonyLedger.includes('private.test/recording'))
    assert.ok(!serializedTelephonyLedger.includes('+15555550123'))
    await db.query(`update analytics_events set properties=jsonb_set(properties,'{callDurationSeconds}','48') where id='ev_callleg_CA123_answered_1'`)
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where event_key='analytics:ev_callleg_CA123_answered_1'`)).rows[0].count, 1, 'callback retries/updates cannot duplicate immutable call events')

    await db.query(`insert into analytics_events(id,event_type,lead_id,rep_id,ts,properties) values($1,$2,$3,$4,$5,$6)`, [
      'ev_sms_1', 'sms_received', 'L-1', 'rep-1', '2026-10-21T13:02:00Z', {
        channel: 'sms', message_direction: 'inbound', message_length: 42, thread_length: 3,
        message_body: 'private customer message', phone: '+15555550123',
      },
    ])
    const interactionLedger = (await db.query(`select * from crm_lifecycle_events where event_key='analytics:ev_sms_1'`)).rows
    assert.equal(interactionLedger[0].entity_type, 'interaction')
    assert.equal(interactionLedger[0].after_values.messageLength, 42)
    assert.ok(!JSON.stringify(interactionLedger).includes('private customer message'))
    assert.ok(!JSON.stringify(interactionLedger).includes('+15555550123'))
    await db.query(`insert into analytics_events(id,event_type,lead_id,rep_id,ts,properties) values($1,$2,$3,$4,$5,$6)`, [
      'ev_quote_section_1', 'quote_section_viewed', 'L-1', 'customer', '2026-10-21T13:03:00Z', {
        quote_id: 'Q-1', quote_total: 1300, quote_section: 'pricing', elapsed_ms: 24000,
        private_comment: 'should not enter the ledger',
      },
    ])
    const quoteEngagement = (await db.query(`select * from crm_lifecycle_events where event_key='analytics:ev_quote_section_1'`)).rows
    assert.equal(quoteEngagement[0].after_values.section, 'pricing')
    assert.equal(quoteEngagement[0].after_values.elapsedMs, 24000)
    assert.ok(!JSON.stringify(quoteEngagement).includes('should not enter the ledger'))

    await db.query(`update crm_leads set data=$2 where id=$1`, ['L-1', {
      id: 'L-1', stage: 'booked', bookedAt: '2026-10-21T14:00:00Z', source: 'partner_referral', sourceDetail: 'Realtor',
      commercialDisposition: 'customer', assignedRepUserId: 'rep-2', assignedRepName: 'Rep Two', lastTouchedByUserId: 'owner-1', lastTouchedByName: 'Owner',
      originCity: 'Windsor', destCity: 'London', moveType: 'residential', moveDate: '2026-11-01', inventory: [{ name: 'Sofa' }, { name: 'Bed' }],
      callLogs: [{ id: 'call-1', date: '2026-10-21T13:00:00Z', direction: 'inbound', durationSeconds: 45, callOutcome: 'answered', answerLatencySeconds: 8, transcript: 'customer private words', recordingUrl: 'https://private.test/audio' }],
      attribution: { originalSource: 'website', utmCampaign: 'spring', gclid: 'click-1', lastCapturedAt: '2026-10-21T13:00:00Z' },
      originAddress: '12 Private Street', phone: '+15555550123',
    }])

    const transitionTypes = (await db.query(`select event_type from crm_lifecycle_events where lead_id='L-1' order by event_type`)).rows.map(row => row.event_type)
    for (const eventType of ['lead_stage_changed', 'lead_source_changed', 'lead_owner_changed', 'lead_booking_link_changed', 'lead_attribution_changed', 'lead_scope_changed', 'lead_call_history_changed']) {
      assert.ok(transitionTypes.includes(eventType), `expected ${eventType}`)
    }
    const leadEvents = (await db.query(`select * from crm_lifecycle_events where lead_id='L-1'`)).rows
    const serializedLeadEvents = JSON.stringify(leadEvents)
    assert.ok(serializedLeadEvents.includes('answerLatencySeconds'))
    assert.ok(!serializedLeadEvents.includes('customer private words'))
    assert.ok(!serializedLeadEvents.includes('private.test/audio'))
    assert.ok(!serializedLeadEvents.includes('12 Private Street'))
    assert.ok(!serializedLeadEvents.includes('+15555550123'))
    assert.ok(!serializedLeadEvents.includes('private@example.test'))

    const afterCall = leadEvents.filter(row => row.event_type === 'lead_call_history_changed').length
    await db.query(`update crm_leads set data=jsonb_set(data,'{callLogs,0,transcript}','"revised transcript"') where id='L-1'`)
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where lead_id='L-1' and event_type='lead_call_history_changed'`)).rows[0].count, afterCall, 'transcript-only edits do not duplicate call measurement events')
    await db.query(`update crm_leads set data=jsonb_set(data,'{callLogs,0,callOutcome}','"no_answer"') where id='L-1'`)
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where lead_id='L-1' and event_type='lead_call_history_changed'`)).rows[0].count, afterCall + 1)

    await db.query(`insert into crm_quotes(id,data) values($1,$2)`, ['Q-1', {
      id: 'Q-1', number: 'QT-1', leadId: 'L-1', status: 'sent', revision: 1, moveDate: '2026-11-01', total: 1200, deposit: 300, balance: 1200,
    }])
    await db.query(`update crm_quotes set data=$2 where id=$1`, ['Q-1', {
      id: 'Q-1', number: 'QT-1', leadId: 'L-1', status: 'accepted', acceptedAt: '2026-10-21T15:00:00Z', revision: 2,
      moveDate: '2026-11-02', total: 1300, deposit: 300, balance: 1000, depositPaidAt: '2026-10-21T15:01:00Z', depositPaidAmount: 300,
      paymentRecords: [{ id: 'p-1', kind: 'deposit', method: 'credit_card', amount: 300, paidAt: '2026-10-21T15:01:00Z', status: 'captured', publicToken: 'do-not-store', cardLast4: '1234', reference: 'secret-ref' }],
    }])
    const quoteEvents = (await db.query(`select * from crm_lifecycle_events where quote_id='Q-1'`)).rows
    for (const eventType of ['quote_created', 'quote_status_changed', 'quote_amounts_changed', 'quote_terms_changed', 'quote_payment_state_changed']) {
      assert.ok(quoteEvents.some(row => row.event_type === eventType), `expected ${eventType}`)
    }
    const serializedQuoteEvents = JSON.stringify(quoteEvents)
    assert.ok(serializedQuoteEvents.includes('depositPaidAmount'))
    assert.ok(!serializedQuoteEvents.includes('do-not-store'))
    assert.ok(!serializedQuoteEvents.includes('1234'))
    assert.ok(!serializedQuoteEvents.includes('secret-ref'))
    await db.query(`update crm_quotes set deleted=true where id='Q-1'`)
    assert.ok((await db.query(`select count(*)::int as count from crm_lifecycle_events where quote_id='Q-1' and event_type='quote_archived'`)).rows[0].count === 1)

    await db.query(`insert into job_outcomes(id,lead_id,quote_id,rep_id,move_date,estimated_hours,actual_hours,actual_crew,revenue_cents,total_costs_cents,net_profit_cents,margin_pct,damage_flag,customer_rating,review_left,referral_generated,notes) values ('O-1','L-1','Q-1','rep-2','2026-11-02',5,6,3,130000,70000,60000,46.2,false,5,true,true,'sensitive customer note')`)
    await db.query(`update job_outcomes set actual_hours=7,total_costs_cents=80000,net_profit_cents=50000,margin_pct=38.5 where id='O-1'`)
    const outcomeEvents = (await db.query(`select * from crm_lifecycle_events where entity_type='job_outcome' and entity_id='O-1'`)).rows
    assert.ok(outcomeEvents.some(row => row.event_type === 'job_outcome_recorded'))
    assert.ok(outcomeEvents.some(row => row.event_type === 'job_outcome_revised'))
    assert.ok(!JSON.stringify(outcomeEvents).includes('sensitive customer note'))

    await db.query(`insert into job_costs(id,lead_id,category,description,amount_cents,cost_date,created_by) values ('C-1','L-1','truck','Private invoice description',25000,'2026-11-02','owner-1')`)
    await db.query(`delete from job_costs where id='C-1'`)
    const costEvents = (await db.query(`select * from crm_lifecycle_events where entity_type='job_cost' and entity_id='C-1'`)).rows
    assert.ok(costEvents.some(row => row.event_type === 'job_cost_recorded'))
    assert.ok(costEvents.some(row => row.event_type === 'job_cost_deleted'))
    assert.ok(!JSON.stringify(costEvents).includes('Private invoice description'))
    assert.ok(JSON.stringify(costEvents).includes('25000'))

    await assert.rejects(db.exec(`update crm_lifecycle_events set event_type='rewritten'`), /append-only/)
    await assert.rejects(db.exec(`delete from crm_lifecycle_events`), /append-only/)
    await assert.rejects(db.exec(`truncate crm_lifecycle_events`), /append-only/)
    await db.query(`update crm_leads set deleted=true where id='L-1'`)
    assert.equal((await db.query(`select count(*)::int as count from crm_lifecycle_events where lead_id='L-1' and event_type='lead_archived'`)).rows[0].count, 1)
  } finally {
    await db.close()
  }
})
