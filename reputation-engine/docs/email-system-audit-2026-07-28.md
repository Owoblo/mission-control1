# Email System Audit — 2026-07-28

## Scope

This audit covers every email surface currently present in Saturn Star OS:

- Zoho-hosted human mailboxes on `starmovers.ca`
- The dedicated `partnerships@starmovers.ca` CRM integration
- Partnership manual outreach, sequences, inbound replies, and partner-portal onboarding
- Resend sales, quote, receipt, approval, and internal-notification sends
- Resend inbound receiving on `inbound.starmovers.ca`
- Instantly campaign events
- CRM persistence, retries, deduplication, and automation handoff behavior
- Live SPF, DKIM, DMARC, MX, and inbound MX records

## Current architecture

| Stream | Sender/provider | Inbound path | CRM destination |
| --- | --- | --- | --- |
| Partnership manual email | Zoho `partnerships@starmovers.ca` | Zoho API poll | `market_touches` |
| Partnership sequence email | Zoho `partnerships@starmovers.ca` | Zoho API poll | `market_touches` |
| Partner portal welcome | Zoho `partnerships@starmovers.ca` | Zoho API poll | Partnership workflow |
| Sales and quote email | Resend `business@starmovers.ca` | `business@inbound.starmovers.ca` | `crm_emails` |
| Receipts | Resend `info@starmovers.ca` | configured reply-to | Sales records |
| Internal alerts | Resend `notifications@starmovers.ca` | not applicable | Staff inboxes |
| Instantly campaigns | Instantly | Instantly webhook | `market_touches` |

## Live DNS findings

Verified on 2026-07-28:

- MX: Zoho Canada is authoritative for `starmovers.ca`.
- SPF: `v=spf1 include:zohocloud.ca ~all`.
- Zoho DKIM: present at `zmail._domainkey.starmovers.ca`.
- Resend DKIM: present at `resend._domainkey.starmovers.ca`.
- DMARC: present, but monitoring-only: `p=none`, relaxed SPF/DKIM alignment.
- Resend inbound: `inbound.starmovers.ca` routes to Amazon SES receiving.

### DNS assessment

- Zoho authentication is structurally present.
- Resend has a DKIM selector, so DMARC can pass through aligned DKIM even though the root SPF record only names Zoho.
- DMARC currently reports but does not quarantine or reject spoofed mail.
- Do not raise DMARC enforcement until aggregate reports confirm both Zoho and every Resend sender are consistently aligned.

## Remediations completed

- Created a dedicated Zoho OAuth client bound to `partnerships@starmovers.ca`.
- Stored production OAuth credentials as protected Vercel variables.
- Added automatic access-token refresh with a one-minute safety margin.
- Removed Partnership manual email from the generic sales sender.
- Removed Partnership sequence email from Resend.
- Moved partner-portal welcome email to the dedicated Zoho mailbox.
- Added a protected manual Partnership email endpoint with permission and market-scope checks.
- Added outbound CRM logging with explicit provider/mailbox metadata.
- Added a two-minute Zoho inbox poll with message-ID deduplication.
- Inbound Partnership replies now pause pending sequences, cancel pending jobs, classify the reply, update pipeline state, and alert the correct market owner.
- Automated Partnership email now includes a visible reply-to-unsubscribe instruction.
- Automated Partnership outreach uses plaintext for robust client rendering and lower template/spam risk.
- Confirmed the new production endpoint rejects unauthenticated requests.
- Confirmed real Zoho API outbound delivery with an internal test message.
- Confirmed TypeScript and production Next.js builds pass.

## Existing strengths

- Quote sends already use a durable outbox with deduplication, exponential retries, terminal failure alerts, and provider-error recording.
- Partnership sequences already claim jobs, cap attempts, and preserve contact/touch state.
- Sales email stores both HTML and plain-text bodies when supplied.
- Resend inbound receiving has webhook signature verification plus a two-minute polling fallback.
- Instantly records sends, opens, clicks, replies, bounces, and unsubscribes.
- Partnership inbound handling cancels future sequence jobs immediately on replies and opt-outs.

## Remaining risks and recommended next controls

### Critical

1. **DMARC is monitoring-only.** Review aggregate reports for at least 7–14 days, then move to `p=quarantine; pct=25`, increase gradually, and eventually use `p=reject`.
2. **Cold-outreach consent/source evidence is not represented as a dedicated field.** Add consent/legal-basis/source and suppression provenance to Partnership contacts before materially increasing volume.
3. **Resend bounce/complaint events are not persisted into the core sales suppression workflow.** Configure webhook handling for `email.bounced` and `email.complained`, then block further automated sends to affected recipients.

### High

1. Generic manual sales email sends are synchronous; only quote sends have the durable retry outbox. Move all transactional sales emails to a common outbox.
2. Internal notification email suppresses provider failures and has no plain-text fallback. Add explicit provider response checks, alerting, and text alternatives.
3. Several direct Resend call sites bypass one centralized provider adapter. Consolidate them to enforce sender identity, reply-to, text fallback, event metadata, and consistent error handling.
4. Template versions are implicit in source code. Add template IDs and versions to outbound metadata for rollback and measurement.

### Medium

1. Zoho inbound polling currently checks the most recent 200 inbox messages and deduplicates against the latest 5,000 email touches. This is appropriate for current volume; move the cursor to a durable sync-state table before scaling significantly.
2. Zoho API HTML messages use Zoho's single-content API rather than MIME multipart. Automated cold outreach was intentionally switched to plaintext; rich transactional Partnership messages remain HTML.
3. Open/click tracking is provider-dependent and inconsistent across streams. Treat clicks as optional engagement signals, not delivery proof.
4. DMARC forensic reports are sent to a normal mailbox. Use a dedicated DMARC reporting/analysis address before enforcing policy.

## Safe rollout sequence

1. Keep Partnership volume low while the new mailbox establishes reputation.
2. Confirm several real replies appear in Partnership Replies with the correct contact and market.
3. Monitor Zoho bounces and spam placement daily for the first two weeks.
4. Implement Resend bounce/complaint suppression.
5. Centralize remaining direct Resend sends.
6. Observe DMARC alignment for 7–14 days.
7. Gradually enforce DMARC.

