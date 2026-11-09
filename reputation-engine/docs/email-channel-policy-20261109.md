# Email channel policy and readiness — 2026-11-09

This policy supersedes historical SES cold-campaign instructions in the partnership relationship playbook. Historical delivery records remain valid evidence of what happened, not instructions to replay old batches.

## Channel ownership

- Sales CRM, quotes, receipts, operational notifications: SES, with the existing delivery ledger, idempotency, and provider event handling.
- Existing human partnership conversations: retain the original authorized sender. Do not automatically move a conversation to a different mailbox or infer an identity across multiple threads.
- New cold email: Google mailbox fleet only. Google OAuth connection and Mailivery warm-up do not enable campaign sending.
- SMS and direct mail remain separate channels governed by shared contact suppression and relationship context.

## Current engineering changes

An isolated candidate based on production source 09aecaa5d0520b587f127f1de32ce81e4c46f42e blocks legacy SES outreach transports, cold reservations, and managed cold sends. The sequence processor excludes email jobs before its query limit. Historical accepted prepared dispatches retain reconciliation without resend. Manual legacy replies require an established human conversation and consistent original sender.

The boundary and dispatch foundation were deployed at fbed418; monitoring and bounce correlation are deployed at f809692. Do not deploy the older dirty main working tree over this release.

## Readiness assessment

Qualitative engineering assessment, not a deliverability score:

| Area | Assessment | Evidence / remaining work |
| --- | --- | --- |
| SES operational transport | Strong | Reservation, provider receipt, unknown-outcome protection, signed event handling, suppression and unsubscribe tests. |
| Google mailbox setup | In progress | Eight connected new mailboxes; connection alone does not prove durable refresh, campaign dispatch or reply ingestion. |
| Cold campaign execution | Not ready | Candidate implements Gmail transport, atomic inbox/domain capacity, sender affinity, suppression rechecks and duplicate-send protection. Monitoring is live; dispatch remains disabled. Launch acceptance and healthy placement evidence remain outstanding. Repeat contact requires the shared policy’s persisted nonresponse review. |
| Monitoring | Partial | A five-minute production worker ingests Mailivery health and ScaledMail weekly results. Reporting was purchased; the API currently has zero completed reports. Missing evidence holds outreach. |
| Fifth-domain migration | Not ready for cutover | Three Zoho exports verified as readable, 214 messages total. Compare source completeness, resolve Google tenant, provision destination and validate import before MX change. |
| Playbook | Strong intent; stale execution details | Use this channel policy; historical SES campaigns must not be replayed. |

## Requirements before first cold campaign

1. Persist each contact/conversation's assigned Google mailbox. Follow-ups use that mailbox and thread; no automatic failover to a different identity.
2. Reserve per-inbox and per-domain capacity atomically, including follow-ups. Initial proposed campaign allowance is 10 per inbox per day, subject to healthy measurements; account for warm-up traffic separately when evaluating total mailbox load.
3. Check current suppression, unsubscribe, prior replies, recipient verification freshness, relationship eligibility and exact reviewed content immediately before sending.
4. Treat stale or missing health evidence as unknown. A warm-up score or seed inbox-placement result is not proof of delivery to a real prospect.
5. Store provider acceptance and message/thread identifiers. An uncertain send must reconcile before retry. Stop follow-ups after replies, bounces or suppression.
6. Verify Google reply ingestion and bounce handling end to end, durable token refresh, scheduled worker operation, alert delivery and an owner kill switch.
7. Begin with a reviewed small city/industry cohort. Increase volume from observed results, not elapsed warm-up time alone.

Mailivery SEM-FRESH detections are domain-age warnings, distinct from abuse-list detections. Preserve both types in reporting; age listings can still affect filtering. ScaledMail screenshots labeled demo/sample are not account measurements.

## Candidate implementation status (later on November 9)

The isolated Google candidate now includes a disabled worker, owner-only status and reviewed-queue admission endpoints, atomic capacity/policy claims, immutable reviewed jobs and sender assignments, Gmail MIME transport, unknown-outcome holds, and thread polling that pauses/cancels pending outreach and records an inbound CRM touch. Capacity is rolling 24 hours (10/inbox and 20/domain by default), with ten-minute inbox pacing. Provider acceptance is not delivery.

Automatic follow-ups deliberately remain held: the current shared relationship policy supports cold introductions and human replies, not unattended follow-ups. The MIME builder preserves original mailbox/thread bindings for a future explicitly reviewed follow-up workflow. Do not label a follow-up as a human reply to bypass that policy.

No campaign cron has been scheduled, no production schema has been migrated, and neither GOOGLE_MAIL_WORKER_ENABLED nor GOOGLE_MAIL_DISPATCH_ENABLED has been activated. The existing OAuth table constraint also prohibits campaign_enabled=true. Keep it until an independently reviewed activation migration and end-to-end tests pass.

Remaining launch work: reconcile this candidate with the operations-phone deployment restored from the previous Google release; connect current health evidence to google_mail_health; implement the reviewed follow-up policy; test original-thread replies, opt-out/bounce handling, token refresh and acceptance reconciliation with owned mailboxes; then schedule bounded polling and prove alert delivery. The current thread poller pauses all non-sent/non-draft responses for human review rather than claiming it has classified human replies reliably. It does not yet scan for delivery notices arriving in unrelated threads.

Gmail implementation references: https://developers.google.com/workspace/gmail/api/guides/sending and https://developers.google.com/workspace/gmail/api/guides/threads .

## Monitoring release, November 9, 2026

Deployment dpl_Gv19yYtgWusuibmBXAYfatTET2uU enables the monitoring worker, not campaign dispatch. The Google mailbox page shows last health/sync checks, warm-up score and spam placement, ScaledMail availability and hold reasons. Warm-up criteria are conservative rollout defaults: active ramp-up, score at least 80, spam placement at most 5%, valid SPF/DMARC/MX, and 28 active days. Passing these alone never authorizes outreach; independent placement and launch acceptance remain required.

Correlated hard bounces require a delivery-status MIME part, failed action, 5.x.x status and exact outbound RFC Message-ID. They suppress the contact and cancel pending/held Google jobs. Unmatched, ambiguous and delayed notices do not automatically mark a contact bounced. Bounded scans fail closed when pagination is incomplete.

Same-inbox follow-up construction was verified live between owned mailboxes with original thread IDs preserved at both sender and recipient. No prospect messages were sent. Automated tests cover sender/recipient/subject changes and paused assignments, plus atomic bounce suppression. This does not authorize unreviewed follow-up sequences.

Legacy saturnstarmovers.ca: johnny@ warm-up reduced to 10/day; retiring jhon@ warm-up paused. john@ remains paused after repeated provider connection losses; it is a legacy SMTP connection pending migration. Zoho and MX records are unchanged.

Scheduled production authentication verified at 2026-11-09 20:45 UTC: all eight mailboxes acquired fresh health and Gmail sync timestamps within 14 seconds. Fleet disabled, zero campaign-enabled connections, zero queued jobs.
