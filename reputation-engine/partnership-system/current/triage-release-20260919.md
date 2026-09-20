# Relationship triage first release

Implementation follows `triage-spec-review-20260919.md` and extends the existing local relationship projection/action planner. No schema migration, message sender, contact merge or stage rewrite.

- Owner page: `/marketing/triage`.
- `GET /api/marketing/relationship-triage`: complete paginated source reads, whole-contact projection, paginated output. A failed source returns503 instead of an empty successful report. Coverage is nontransactional and bounded at100,000 records per source.
- `POST` with explicitly selected action keys: reread evidence, reject stale/assigned actions, insert idempotent review tasks in existing `crm_tasks`. No external messages.
- Covers unclassified unanswered SMS/email (four elapsed hours), existing due tasks/promises, scheduled meetings with no recorded outcome after24hours, and unacknowledged new handoffs after four weekday working hours (09:00–17:00 Toronto). Holidays are not modeled yet.
- Failed/queued messages, physical-print receipts and inbound reactions do not answer an inbound SMS/email. A later SMS does not fulfill a requested email. Preserve named people even where phone numbers match.
- Explicit suppression remains in audit output but outside active work. Existing suppression classifications are not automatically revoked.

Boundaries: this release is on-demand and owner-operated. It does not implement a scheduled durable sweep, mobile push delivery, calendar integration, natural-language promise extraction, automatic price-list delivery, or autonomous replies. Existing recorded task due dates are respected. Unknown meeting outcomes request review, not an automatic reschedule. No claim that the entire original spec is complete.

Next release: durable coverage checkpoint + authenticated dedicated scheduler, business-calendar SLA configuration, integrated push acknowledgment, and source-linked promise extraction with correction-aware classification.
