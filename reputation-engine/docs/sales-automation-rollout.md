# Sales Automation Rollout

This backend adds the first working pass of:

- speed-to-lead automation for website, Zapier, inbound SMS, and inbound email
- address-aware enrichment that can pull MLS/listing inventory before replying
- automated estimate generation by email once route, inventory, date, and email are on file
- queued quote follow-up, survey follow-up, and booked-move reminders
- stale lead reactivation job generation
- shared outbound send logic so human sends pause automation and automation sends update lead state consistently

## What changed

- New Supabase tables:
  - `crm_conversation_threads`
  - `crm_automation_jobs`
- New app routes:
  - `POST /api/sales/automation/ingest`
  - `POST /api/sales/automation/process`
  - `POST /api/sales/automation/reactivate`
  - `PATCH /api/sales/leads/:id/automation`
- New server modules:
  - `lib/server/sales-automation-repository.ts`
  - `lib/server/sales-messaging.ts`
  - `lib/server/sales-automation.ts`
- Worker webhook integration:
  - `worker/saturn-lead-intake.js` now forwards website forms, Zapier leads, missed calls, and inbound SMS to the app automation endpoint when configured

## Required rollout steps

1. Apply the migration:
   - `supabase/migrations/20260419000000_create_sales_automation_tables.sql`

2. Keep the app and worker on the same `WORKER_SHARED_SECRET`.

3. Add this worker variable:
   - `CRM_AUTOMATION_INGEST_URL=https://<app-domain>/api/sales/automation/ingest`

4. Add a scheduler or cron job that calls:
   - `POST /api/sales/automation/process`
   - Header: `x-internal-secret: <WORKER_SHARED_SECRET>`

5. Trigger stale reactivation manually at first:
   - `POST /api/sales/automation/reactivate`
   - Body example: `{ "limit": 100, "daysInactive": 30 }`
   - Header: `x-internal-secret: <WORKER_SHARED_SECRET>`

## Recommended cron cadence

- `automation/process`: every 5 minutes
- `automation/reactivate`: manual first, then daily once messaging quality is approved

## Current behavior notes

- Inbound website, Zapier, SMS, and email now attempt immediate app-side automation first.
- If the worker cannot reach the app webhook, the old worker fallback autoresponders still run.
- Human outbound messages now pause automation for 12 hours.
- Assigning a rep pauses automation for 6 hours.
- Saving a consultation or pushing a lead into `estimate_scheduled` / `estimate_completed` forces `handoff` for 24 hours.
- Leads with recent rep activity or an active estimate window are suppressed from auto-reply, even if a new inbound message arrives.
- If the lead provides an address, the automation tries to enrich from listing data and cached MLS-photo inventory before composing the next response.
- If route, inventory, move date, and customer email are all on file, automation can generate and email a quote automatically instead of sending another discovery text.
- Booked moves queue a reminder automatically when a move date exists.
- Quote follow-up queues only when quote status transitions to `sent`.
- Survey follow-up queues only after a survey request is generated.

## Rep handoff controls

- Manual kill switch:
  - `PATCH /api/sales/leads/:id/automation`
- Useful bodies:
  - `{ "automationStatus": "handoff", "pauseHours": 24, "handoffReason": "Rep on site" }`
  - `{ "automationStatus": "paused", "pauseHours": 6, "pauseReason": "Manual follow-up in progress" }`
  - `{ "automationStatus": "active", "clearPause": true }`

Use `handoff` when the rep owns the conversation and the AI should stay out entirely. Use `paused` when the team wants a temporary quiet window but may hand the lead back to automation later.

## Safe first checks after deploy

1. Submit a website lead after hours and confirm:
  - a CRM lead is created automatically
   - a `crm_conversation_threads` row is created
   - a `crm_automation_jobs` row is created and completed
   - an outbound reply is logged in SMS or email history

2. Send an inbound text from a lead phone number and confirm:
   - the existing lead is matched
   - the thread updates instead of creating a duplicate lead
   - the reply lands in under a minute

3. Put a lead into rep-owned flow and confirm suppression:
   - assign a rep or schedule an estimate
   - send an inbound SMS from that lead
   - confirm a thread row is created/updated but the automation job is cancelled with a rep-workflow reason
   - confirm no outbound AI reply is sent

4. Create a fully-qualified text-to-estimate lead and confirm:
   - lead has origin address, destination, move date, and email
   - listing enrichment fills inventory or volume
   - inbound reply triggers an automated quote email instead of another discovery message
   - if the inbound channel was SMS, the customer receives only the short “I emailed your estimate” confirmation text

5. Mark a quote as `sent` and verify a queued `quote_followup` job is created.

6. Confirm a booked job with a move date and verify a queued `move_reminder` job is created.

## Future Voice Routing For Remote Sales Reps

This is not part of the current rollout. It is the recommended future-state design once multiple remote reps are handling inbound calls.

### Goal

Keep every branch number inside the same Mission Control voice pipeline while allowing multiple remote reps to answer from different devices without losing logging, recording, transcription, or branch/source attribution.

### Core rule

Inbound calls must always hit the app webhook first.

Do not point branch numbers directly at rep phones. Twilio should stay in the middle so Mission Control can:

- log the call before a human answers
- preserve the inbound branch number and source context
- record and transcribe consistently
- trigger missed-call automations and alerts when nobody answers

### Recommended routing model

1. Customer calls a branch number.
2. Twilio sends the call into the Mission Control voice webhook.
3. Mission Control creates or updates the inbound call record with:
   - branch number
   - branch label
   - lead ID when matched
   - source/campaign metadata when available
4. The voice layer selects reps who are currently available.
5. Twilio rings the selected rep endpoints.
6. The first rep to answer gets connected.
7. The remaining endpoints stop ringing.
8. If nobody answers within the timeout window, the call falls into the fallback path.

### Rep endpoint model

Each remote rep can have one or more endpoints:

- personal cell
- Linphone SIP endpoint
- browser softphone or Twilio client later

Recommended behavior:

- ring a rep's active endpoints together
- ring multiple available reps at once
- do not ring reps who are already on an active voice call

### Rep availability states

Mission Control should eventually track rep presence with explicit states:

- `available`
- `busy`
- `wrap_up`
- `offline`

Minimum routing rules:

- `available`: can receive inbound calls
- `busy`: skip for new voice calls
- `wrap_up`: temporary cooldown after a call so notes can be finished
- `offline`: never ring

### Suggested first production version

For a small remote team, the first practical version should:

- ring 2 to 4 available reps simultaneously
- let the first answered endpoint win
- suppress new voice calls to reps already marked `busy`
- keep the current branch-aware logging, recording, and transcription pipeline intact

This gives fast pickup without requiring a full call-center stack on day one.

### Fallback behavior when nobody answers

If no rep answers, the call flow should do something deliberate instead of failing silently:

- route into the AI voice flow when enabled
- capture voicemail when AI handoff is not appropriate
- send a missed-call SMS from the same branch number the customer called
- create an internal alert in Mission Control

This keeps leads from going cold and preserves a complete audit trail.

### Why this is better than direct forwarding

Directly forwarding branch numbers to personal phones is acceptable for a single-owner stage, but it breaks down once multiple reps are involved because:

- busy-state awareness is weak
- simultaneous routing is limited
- branch/source context is easier to lose
- fallback behavior becomes inconsistent

Keeping Twilio and Mission Control in the middle avoids those problems.

### Data Mission Control should retain for each routed call

- inbound branch number
- branch label
- selected rep IDs
- answering rep ID
- answer timestamp
- final disposition
- recording SID and URL
- transcription status
- fallback path used when unanswered

### Long-term implementation options

The likely progression is:

- Phase 1: simultaneous ringing with a small rep pool
- Phase 2: explicit rep presence and busy-state enforcement
- Phase 3: queue-based routing and skills-based assignment when the team grows

Twilio features that fit this evolution include:

- TwiML `<Dial>` with multiple targets for simple simultaneous ringing
- SIP endpoints for Linphone-style softphone routing
- Twilio client/browser calling if the team moves away from personal devices
- TaskRouter or queue-based routing once agent-state logic becomes more advanced

### Simple English summary

Later, when remote sales reps are added, the branch number should still come into Mission Control first. Then the system can ring several reps at once, skip reps who are already busy, connect the first one who answers, and fall back to AI, voicemail, SMS, and alerts if nobody picks up. That keeps the operation centralized while preserving clean logs, recordings, transcripts, and branch attribution.
