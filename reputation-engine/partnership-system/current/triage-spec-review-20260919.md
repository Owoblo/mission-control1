# Triage spec review — September 19, 2026

Source reviewed: `/Users/owoblo/Downloads/partnership-triage-engine-spec.md`.
Scope: repository inspection and existing operational snapshots, not certification of every production deployment or a reproduction of the source audit. No new sender, parallel conversation store, or stage machine was deployed for this review.

## Verdict

Adopt the coverage, ownership, overdue-work, handoff acknowledgment, and evidence-based learning requirements. Extend the existing relationship intelligence system. Do not implement the spec verbatim: several identity, suppression, scheduling, and qualification rules would regress the owner's requirements.

## Existing implementation and gaps

| Capability | Evidence | Assessment |
|---|---|---|
| Multidimensional relationship state | `lib/relationship-state.ts` projects identity, qualification, production, engagement, contactability and obligations | Implemented; preserve rather than replace with one enum. Suppression projection does not yet include all fields used by sender gates. Historical wrong-number classifications need correction-aware resolution. |
| Portfolio context and complete reads | `lib/server/relationship-intelligence.ts`, `lib/server/read-complete-rest.ts`, `lib/saturn-command-context.ts` | Implemented read path with keyset pagination, 100,000-row cap and explicit read errors. Not proof of an independently scheduled full-universe triage worker; reads are not transactional snapshots. |
| Request-to-action projection | `lib/relationship-development.ts`, `app/api/marketing/relationship-intelligence/route.ts` | Implemented for structured outcome codes, existing tasks and linked fulfillment evidence. Unclassified historical messages can fall through. Many actions lack a due date or owner. |
| Existing task persistence | Relationship API `create_task`, task repository, `crm_tasks` | Reuse. One relationship can have multiple obligations; display the next priority without deleting the others. |
| Appointment records | `app/api/marketing/appointments/route.ts`, `app/api/marketing/touches/route.ts` | Existing paths populate `meeting_booked_at`. Null values do not prove no meeting happened. Distinguish scheduled time, booking-created time and outcome. |
| Suppression timestamps | `20260911103000_email_command_center_foundation.sql` plus email handlers | Already has `cross_channel_suppressed_at` and `email_unsubscribed_at`; audit SMS event history instead of adding a redundant generic column. |
| Sales handoffs | `app/api/marketing/lead-handoffs/process/route.ts` | Existing partner-opportunity identity, Thelma assignment and notification. Bounded reads of 5,000 touches/10,000 leads need completeness review. Acknowledgment watchdog with business-hour SLA is not established by this inspection. |
| Human correction evidence | Relationship API `correct`, `saturn_ai_decisions`, `partner_activity_logs` | Implemented append-only correction records; empty legacy learning tables alone do not prove no learning evidence exists. Outcome linkage remains incomplete. |
| Event-driven touch candidates | `planRelationshipActions` handles listing/referral/completion signals | Implemented review-only candidates; a signal never grants send permission. |
| Print fulfillment | Five accepted printer emails, 50 contact timeline entries, open dispatch tasks | Executed and CRM-verified this session. Printer acceptance is not posting or delivery. |
| Phone push approval tray and complete SLA supervision | Not established in reviewed relationship routes | Treat as incomplete until integrated delivery, ownership and action tests demonstrate it. |

## Required changes to the proposed specification

1. **Phone numbers are routes, not person identities.** Shared brokerage switchboards can belong to multiple people. Normalize numbers, detect collisions, and maintain evidence-backed person/account/channel links. Never merge all shared-number contacts automatically or blend their private conversation histories.
2. **Keep multiple state dimensions and obligations.** A producing partner may also be a customer, have a meeting booked, and owe an introduction. One primary displayed action is useful; one exclusive persisted stage/action loses facts.
3. **Wrong-recipient context is not automatically opt-out.** Alfonso's message was intended for a garbage-disposal business; it did not establish that Saturn had the wrong person. True opt-outs remain deterministic hard stops. Keep suppressed records in audit/coverage results while excluding outreach actions.
4. **Existing mover and silence do not prove permanent rejection.** Preserve legitimate relationship knowledge and stop unwarranted messaging. Closure, bad news, and temporary sensitivity need separate evidenced reasons; do not invent a permanent suppression from a weak classifier.
5. **Do not promise visits automatically.** “Drop by anytime” does not give the system John's availability. Address acknowledgment should create fulfillment work; actual booking requires availability and confirmation. Auto-acknowledgments such as “back to you today” create promises and are inappropriate without an accountable executor.
6. **Unknown meeting outcome is not a missed meeting.** First ask the owner/log the outcome; only propose rescheduling when warranted. Meetings or office introductions are not automatically consumer sales leads.
7. **Resolve pricing contradiction.** The spec both forbids AI quoting and says to send price lists. Deliver a current approved rate document when requested and permitted; scope-specific prices, discounts and negotiations require the authorized process.
8. **Autonomy is action-specific.** The spec alternates between human approval of every message and automatic routine execution. Existing owner authorization remains valid. Use explicit allowlists, policy gates, stale-context checks and receipts. An 80-word threshold can flag review but is not sufficient evidence of risk by itself.
9. **Ottawa is resolved by the owner.** Use Dexa Movers / Dr. Courage. Do not reopen the branding decision. Actual channel eligibility remains subject to existing policy. Thelma is already the named sales recipient in this session and code; ensure assignments resolve to an actual accountable user.
10. **Correct the Natasha acceptance test.** Snapshot source message dated September 15 explicitly says reconnect after **October 5**, not October 1. Existing readiness notes specify **October 6** review. Test source evidence and superseding promises rather than hardcoding the spec's erroneous October 2 date.
11. **Coverage does not require rereading every lifetime message every 15 minutes.** Use change-driven triage plus a durable, paginated full sweep with watermark, reconciliation, counts, failures and maximum staleness. No contact may remain silently outside coverage. Incomplete reads must not produce “all clear.”
12. **Audit numeric claims before using them.** The 31-hour median, 20.8% unanswered, 59/61 unacknowledged, 434/zero revival cohort, and 61/62 suppression claims are source-document assertions not reproduced here. Define eligible inbound, reaction/auto-reply exclusions, observation window, delivery denominator, channel joins, and suppression-before-send ordering. Uncited industry churn/failure/copy-decay percentages should not dictate architecture.

## Incremental implementation order

1. Inventory production versions and build a reproducible read-only coverage report over existing contacts, touches, sales messages, tasks, appointments and referral links. Expose unclassified and identity-conflicted records explicitly. Preserve evidence IDs and source coverage.
2. Extend existing action projection with unanswered-inbound review, source-backed promise due dates, meeting-outcome review and handoff-acknowledgment deadlines. Deduplicate using existing source keys; store deadlines/owners as fields rather than prose only. Use market business hours and time zones.
3. Add a durable sweep/checkpoint worker and idempotent alert delivery on existing infrastructure. Prioritize actual job requests and complaints, then overdue promises and required responses. Push notifications must be verifiably delivered and support scoped, expiring actions that revalidate current state.
4. Integrate the existing draft/correction stores with approve/edit/reject outcomes and versioned policy decisions. Enable only approved routine actions; run shadow comparison before enabling autonomous sends.
5. Evaluate segment-level outcomes and trigger-based nurture. Approved rate/card delivery is not a producing partner; producing and repeat status require actual referral/job evidence.

Acceptance cases include all-pages coverage; source read failure; shared switchboard; Alfonso mistaken destination; known-name preservation; Natasha October 6; no outcome vs no-show; requested email still outstanding after SMS; print submitted vs mailed; handoff acknowledgment business hours; duplicate scan; stale approval; explicit opt-out; and Ottawa identity isolation.

## Continued operations

The print fulfillment report remains `deliverables/partnership-print-2026-09-19/FULFILLMENT-REPORT.md`. Fifty submissions are logged with provider receipts. Six address clarifications and personal visits remain separate work; no resubmission merely to remove email prose. Future printer emails use PDF attachments and a short subject only. Dispatch confirmation must come from printer/operator evidence.
