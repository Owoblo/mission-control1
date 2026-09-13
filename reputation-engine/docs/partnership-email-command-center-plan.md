# Partnership Email Command Center Plan

Last updated: September 11, 2026

This is the operating plan for making partnership email work at an Instantly-style standard inside Saturn Star OS.

## Current Setup

The system currently has three email paths:

- Resend powers general CRM and sales emails from `business@starmovers.ca`, with replies routed to `business@inbound.starmovers.ca`.
- Partnership fulfilment has Zoho configuration for a partnership mailbox, including account, refresh token, and from-address settings.
- Instantly integration exists for listing campaigns, adding leads, reading activity, and receiving webhooks, but the live Instantly workspace currently returns `402 Payment Required`, so campaign sync is blocked until the Instantly plan is active.

The CRM already polls Resend inbound email every two minutes and processes partnership sequence jobs every fifteen minutes. Inbound email replies can pause partnership sequences when the sender email matches a `market_contacts.email` record.

## Main Gaps

- Only 314 of 9,863 live partnership contacts currently have email addresses.
- CRM has no contacts currently marked with `instantly_campaign_id` or `instantly_status`.
- Instantly webhook secret is not configured.
- Dexa email sending is not configured.
- Manual partner email sends are logged in `market_touches`, but the email command center is not yet strong enough to manage campaigns, reply classes, bounces, opens, and next actions in one place.
- Email sending is split between Resend, Zoho, and Instantly-style routes. The operator needs one control plane regardless of provider.

## Target Standard

The goal is not only to send email. The goal is to manage email like a campaign operating system:

- Import and enrich contacts by category, city, owner, company, website, email, phone, and preferred channel.
- Deduplicate by email, phone, company, and person name.
- Assign each contact to one campaign, one message version, one sender identity, and one service region.
- Schedule a controlled sequence with clear stop rules.
- Track sent, delivered/provider-accepted, opened, clicked, replied, bounced, unsubscribed, and manually handled.
- Pause all automation when the person replies by SMS, email, phone, or form.
- Suppress across all channels when someone opts out.
- Show all SMS, email, call, direct mail, and task history in one partner contact view.

## Deliverability Requirements For Thousands Per Day

High-volume cold/partner email should not run from one normal mailbox. It needs a sender pool, slow ramping, monitoring, and automatic suppression.

Minimum domain setup:

- SPF configured for every provider that sends mail.
- DKIM configured for every sending domain/provider.
- DMARC configured on the sending domain, with reporting enabled.
- From-domain alignment with SPF or DKIM so DMARC passes.
- TLS supported by the sending provider.
- Valid forward and reverse DNS for sending infrastructure when using dedicated SMTP/IP infrastructure.
- Separate transactional mail from outreach mail. Do not let cold outreach damage quote, receipt, booking, or customer-service email reputation.

Bulk-sender requirements:

- Gmail treats a domain as a bulk sender once it sends around 5,000 messages/day to personal Gmail accounts.
- Bulk senders need SPF, DKIM, DMARC, low spam rates, and one-click unsubscribe for marketing/promotional mail.
- Keep Gmail Postmaster spam rate below 0.3%.
- Add both `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers for promotional outreach.

Operational requirements:

- Verify/enrich emails before sending.
- Suppress hard bounces immediately.
- Suppress spam complaints immediately.
- Suppress unsubscribes across email, SMS, and calls.
- Pause all sequences when any reply arrives.
- Track per-domain performance, not only global performance.
- Ramp new mailboxes slowly.
- Do not send the same copy to thousands with no personalization or segmentation.

## Sender Pool Strategy

For thousands per day, use a pool of warmed sender accounts rather than one mailbox.

Instantly's published recommendation for normal connected mailboxes is about 30 campaign emails per account per day, with campaign limits calculated as accounts multiplied by the daily account limit. AirMail mailboxes can be lower. That means:

- 10 accounts at 30/day: about 300 campaign emails/day.
- 25 accounts at 30/day: about 750 campaign emails/day.
- 50 accounts at 30/day: about 1,500 campaign emails/day.
- 100 accounts at 30/day: about 3,000 campaign emails/day.

Warmup guidance from Instantly:

- New accounts should warm gradually.
- Suggested new-account warmup settings include increasing by 1/day, daily warmup limit around 10, and reply rate around 30%.
- Let accounts warm for at least two weeks before campaigns, and ideally use accounts with strong health scores.

Saturn-specific note: `saturnstarmovers.ca` has already been warmed for about 3 months inside Instantly. That improves domain/mailbox trust and means we are not starting from zero. It does not fully transfer SES sending reputation, because SES uses different outbound infrastructure and configuration-set behavior. Treat the domain as warmed, but treat SES as a new sending channel: verify Postmaster/SES health, start with modest daily caps, and ramp only while bounce, complaint, reply, and inbox-placement signals stay clean.

CRM rules for sender pools:

- Store every sender account as a first-class record: provider, domain, mailbox, status, daily cap, ramp stage, health score, last error, paused flag.
- Assign campaigns to sender pools by category and geography.
- Rotate senders automatically but keep replies threaded to the original mailbox/provider.
- Stop using a sender when bounces, complaints, provider errors, or low engagement cross thresholds.
- Never use the main customer mailbox as the high-volume cold outreach sender.

## Provider Strategy

Use the CRM as the source of truth. Providers are delivery and tracking tools.

- Use Resend for transactional/manual emails and internal notifications.
- Use Zoho when the message must appear from the actual partnership mailbox and ideally show in the mailbox sent folder.
- Use Saturn CRM plus Resend/SES/Sendy as the low-cost Instantly replacement when Instantly is too expensive. Keep Instantly optional for later if we want managed warmup, native sender pools, and packaged cold-outreach analytics.

If Instantly is inactive or skipped, the CRM should still prepare campaigns, preview contacts, store receipts, manage replies, enforce suppression, and run controlled email sequences through Resend or SES. Do not pretend SES/Sendy alone gives the same automated warmup controls as Instantly.

Provider notes:

- Resend is strong for transactional/manual sending, inbound receiving, webhooks, and event storage. Paid plans remove daily quota limits, but the default account rate limit starts at 5 requests/second. Batch sending can send up to 100 emails per API call, and high-volume usage may need a rate-limit increase.
- Resend requires bounce and complaint monitoring. Their published threshold guidance says bounce rate should stay under 4% and spam rate under 0.08%.
- Instantly is better suited for cold outreach sequencing, warmup, sender rotation, campaign controls, and Unibox-style reply management. Its API and webhooks require an active Email Outreach plan, and webhooks require Hyper Growth or above.
- Google Workspace and Microsoft 365 mailboxes are not a bulk-email engine by themselves. Google personal Gmail has low daily limits; Exchange Online has per-mailbox recipient and message-rate limits and Microsoft explicitly points legitimate bulk commercial email toward third-party providers built for that use case.

## Low-Cost Instantly Replacement Plan

Instantly is convenient because it combines sender accounts, warmup, campaign sequencing, tracking, reply management, and inbox views in one product. We can recreate most of the business workflow inside Saturn Star OS, but we need to separate two things:

- Delivery infrastructure: the provider that physically sends and tracks the email.
- Control plane: the CRM logic that decides who gets what, when to pause, what replies mean, and what the operator should do next.

The best low-cost version is:

1. Use the separate outreach domain for cold partnership email.
2. Use Amazon SES for high-volume sending and event publishing.
3. Use Saturn CRM for sequences, sender throttling, campaign previews, contact timelines, reply queue, suppression, and reporting.
4. Use Sendy only where it helps with newsletter-style list management, templates, autoresponders, simple campaign reports, and cheap SES sending.
5. Keep Resend for CRM/manual/transactional messages, inbound routing, and lower-volume partner package sends.

This gives us a cheaper Instantly-style operating system without depending on Instantly's subscription. The tradeoff is that warmup, sender health, unibox, and sequencing become our responsibility.

## Resend vs SES + Sendy

| Area | Resend | Amazon SES + Sendy | Saturn CRM layer we must build |
| --- | --- | --- | --- |
| Sending | Simple API and already integrated | Cheapest scalable sending through SES; Sendy gives a UI on top | Provider adapter so campaigns can choose `resend`, `ses`, or `sendy` |
| Inbound replies | Already polling/receiving into CRM | SES inbound can receive to S3/SNS/Lambda or forwarding setup; Sendy is not a true unibox | Unified email reply inbox matched to `market_contacts` |
| Opens/clicks | Webhooks supported | SES event destinations support opens/clicks; Sendy reports opens/clicks | Store every event in `email_events` and mirror key outcomes into `market_touches` |
| Bounces/complaints | Webhooks supported | SES suppression list + event destinations; Sendy auto-handles bounces/complaints for lists | Cross-channel suppression and contact status updates |
| Sequencing | We already have sequence jobs | Sendy has autoresponders but not cold-outreach-grade routing | Extend `sequence_jobs` for email steps, delays, caps, provider receipts |
| Sender rotation | Not built-in for our app | SES identities can send, but mailbox-style rotation is on us | `email_sender_accounts` with caps, ramp, health, pause state |
| Warmup | Not a cold email warmup product | SES/Sendy do not give Instantly-style inbox-to-inbox warmup | Manual/third-party warmup or slow ramp + seed testing + health scoring |
| Unibox | Not built as a campaign unibox | Sendy is campaign/list focused, not a sales reply command center | Build reply queue grouped by intent and next action |
| Cost | Higher than raw SES but simple | Very cheap per email once SES is approved | More engineering, more operator discipline |

## What We Can Replace From Instantly

We can build these inside Saturn Star OS:

- Campaign builder by category, city, region, owner, message version, provider, and sender pool.
- Preview before send with dedupe, missing email, bad status, DNC, and existing conversation warnings.
- Sequences with Day 0, Day 4-7, and Day 12-18 steps.
- Per-sender daily caps and slow ramping.
- Provider adapters for Resend first, SES next, and Sendy if we want to push a campaign into Sendy.
- Open, click, delivered, bounce, complaint, unsubscribe, and reply event ingestion.
- Unibox-style reply queue in the CRM.
- AI reply classification: interested, asks pricing, asks insurance, asks service area, asks for card, not interested, unsubscribe, wrong person, auto-reply, human review.
- Automatic pause when someone replies by email, SMS, phone, or form.
- Cross-channel suppression so a complaint/unsubscribe blocks email, SMS, and calls.
- City/category dashboards for sent, opened, clicked, replied, bounced, complained, opt-out, opportunities, quotes, and booked jobs.

## What We Cannot Fully Replace Without Another Tool

We cannot honestly recreate Instantly's warmup pool by ourselves unless we connect to an external warmup network or buy warmed mailboxes. SES and Sendy do not create natural inbox-to-inbox warmup conversations with other users. We can reduce risk with slow ramping, clean data, seed testing, and domain separation, but that is not the same as automated warmup.

So the rule is:

- For owned/permissioned lists, SES + Sendy is strong.
- For cold outreach at high scale, SES can send cheaply, but deliverability depends on domain setup, sender reputation, slow ramping, email quality, and list quality.
- If we want Instantly-style warmup without Instantly, we either add a cheaper warmup provider, use pre-warmed mailboxes, or ramp very slowly.

## Recommended Architecture Now

Use this stack:

- Outreach domain: the separate domain the business already has set aside.
- DNS: SPF, DKIM, DMARC, MX, tracking domain, bounce domain, and unsubscribe domain.
- Delivery provider phase 1: Resend for immediate controlled tests because it is already wired.
- Delivery provider phase 2: Amazon SES for cheap scale after production approval and event destinations are configured.
- Optional Sendy: use as a campaign/template/list UI when we want newsletter-style sends, but do not make Sendy the source of truth.
- Source of truth: Saturn CRM.
- Event destination: all provider events become rows in `email_events`, with important campaign outcomes mirrored into `market_touches`.
- Reply destination: inbound replies land in one CRM email inbox and get matched to `market_contacts`.

## Build Order For The Low-Cost Route

1. Add provider-neutral campaign tables: `email_campaigns`, `email_campaign_steps`, `email_sender_accounts`, `email_campaign_recipients`, and `email_provider_events`.
2. Add a provider adapter interface with `sendEmail`, `sendBatch`, `parseWebhook`, `getMessageStatus`, and `suppressRecipient`.
3. Make Resend the first adapter because the key, sending, inbound poll, and webhook pieces already exist.
4. Add SES adapter after AWS SES domain verification and production access are ready.
5. Add Sendy adapter only for pushing contacts/campaigns to Sendy lists or reading Sendy campaign status; keep sequencing decisions in the CRM.
6. Build the unibox view from `crm_emails`, `email_events`, and `market_touches`.
7. Build reply classification and next-action buttons using the same rules as SMS.
8. Add daily cap/ramp logic so new senders start low and increase only when bounce/complaint/error rates stay safe.
9. Add one-click unsubscribe handling and a public unsubscribe endpoint for email outreach.
10. Add reporting by domain, sender account, city, category, source list, and template version.

## Multi-Domain Scale Plan

Use `saturnstarmovers.ca` as the first active outreach domain because it has already been warmed for about 3 months in Instantly. For GTA and higher-volume categories, add extra outreach domains instead of forcing all volume through one sender. Each domain needs its own setup record and health limits.

Per domain, track:

- Domain name and DNS host.
- Sending provider and region.
- Sender inboxes such as `john@domain`, `partners@domain`, or category-specific aliases.
- Warmup start date, warmup provider, warmup health score, and campaign-ready date.
- SPF, DKIM, DMARC, custom MAIL FROM, bounce/complaint handling, and tracking-domain status.
- Daily cap, ramp day, current health score, last bounce rate, last complaint rate, reply rate, and pause reason.

Ramp rule:

- Warmed domain on a new provider: begin at 25-50/day, then increase only when bounce rate stays below 2%, complaint rate stays near zero, and replies are healthy.
- New domain: warm for at least 2-3 weeks before real campaigns, keep warmup around 10/day at first, then introduce campaign volume slowly.
- Never mix customer operations email and cold partnership outreach on the same sender pool.

Bulk-send architecture:

- CRM remains the source of truth for contacts, categories, cities, stages, suppressions, and replies.
- SES handles scale once production access is approved.
- `email_sender_accounts` controls sender rotation, daily caps, health, pause state, and ramp day.
- Email verification runs before a contact can enter an email campaign.
- First-touch emails stay plain text. Rich proof assets are sent only after interest, request, or relationship.

## Signature and First-Touch Content Policy

Use the lightest signature for first-touch partnership outreach while SES reputation is being established:

```text
John
Saturn Star Movers
john@saturnstarmovers.ca
https://saturnstarmovers.ca
```

Do not use logo images, large HTML signatures, attachments, rate cards, insurance PDFs, multiple links, or open-tracking pixels in the first email. Use richer proof assets only after a positive reply, a request for details, or an existing relationship. This keeps first-touch emails closer to human business email and reduces spam-filter friction while the domain is ramping on SES.

For replies and warm contacts, a richer signature is allowed if it stays compact: name, role, company, phone, website, and a small logo at most. Avoid banners, social-icon clusters, legal clutter, and image-only contact details.

## First Test Campaign Without Instantly

Start with a small email-first test, not thousands.

Recommended first category: law firms / real estate lawyers.

Why: they are close to closings, moving dates, estate moves, downsizing, and office transitions. The message is useful and less awkward than a generic cold pitch.

Test shape:

- 1 outreach domain.
- 2-5 sender identities or one SES identity while volume is low.
- 50-100 verified emails for the first run.
- One city/region at a time.
- Day 0 only at first.
- Pause on every reply, bounce, complaint, unsubscribe, or SMS/call response.
- Review copy, reply categories, and bounce rate before scheduling touch 2.


## Recommended Data Model

Add or formalize these fields where they are not first-class yet:

- `email_status`: none, valid, risky, bounced, unsubscribed, replied, active, paused.
- `email_source`: manual, website, directory, uploaded_csv, instantly, apollo, clay, google, referral.
- `email_verified_at`.
- `email_last_sent_at`.
- `email_last_opened_at`.
- `email_last_clicked_at`.
- `email_last_replied_at`.
- `email_last_bounced_at`.
- `email_unsubscribed_at`.
- `email_campaign_id`.
- `email_campaign_name`.
- `email_sequence_step`.
- `email_message_version`.
- `email_provider`: resend, zoho, instantly.
- `email_provider_lead_id`.
- `email_provider_message_id`.
- `cross_channel_suppressed_at`.
- `cross_channel_suppression_reason`.

Keep `instantly_campaign_id`, `instantly_lead_id`, and `instantly_status` as provider-specific fields or migrate them under a provider metadata object later.

## Category Priority

Recommended next email-first categories:

1. Law firms / real estate lawyers.
2. Interior designers and home stagers.
3. Insurance brokers and agents.

Law firms are closest to closing, interior designers and stagers are closest to pre-listing movement, and insurance agents are useful but less directly tied to moving timing.

## Email-First Sequence

Use two or three touches, then pause.

Day 0: Initial intro.

Day 4-7: Useful follow-up with digital card/rate/insurance offer.

Day 12-18: Final light check-in.

Stop immediately when:

- They reply.
- They unsubscribe or ask not to be contacted.
- They bounce.
- They respond by SMS or phone.
- A human marks the relationship handled.
- They become a live quote/referral opportunity.

## Sample Category Messages

### Law Firms

Subject: Local moving option for clients around closing

```text
Hi {firstName},

My name is John from Saturn Star Movers. We help clients with residential and small commercial moves across {city} and surrounding areas.

I wanted to introduce us in case any of your clients ever need a reliable moving option around closing, downsizing, estate moves, or office transitions.

We are insured, and for larger moves we usually provide flat-rate quotes so clients know what to expect upfront.

Would it be okay if I sent over a short digital card with our contact info and service details?

John
Saturn Star Movers
```

### Interior Designers And Stagers

Subject: Moving help for staging, installs, and client projects

```text
Hi {firstName},

My name is John from Saturn Star Movers. We help with moving, furniture handling, and client moves across {city} and surrounding areas.

I wanted to introduce us in case you ever need an extra moving option for staging prep, furniture rearranging, delivery coordination, or clients who are getting ready to move.

Would it be okay if I sent over our digital card and service details?

John
Saturn Star Movers
```

### Insurance Brokers

Subject: Local moving contact for clients

```text
Hi {firstName},

My name is John from Saturn Star Movers. We help clients with moves across {city} and surrounding areas.

I wanted to introduce us in case any of your clients ever ask for a reliable moving company after a home purchase, tenant move, claim-related relocation, or downsizing situation.

Would it be okay if I sent over a short digital card with our contact info?

John
Saturn Star Movers
```

## Control-Plane Requirements

The CRM should have an email campaign queue with:

- Campaign name, category, city/region, provider, sender identity, message version, daily cap, and status.
- Contact preview with dedupe, suppression, missing-email, risky-email, and wrong-category warnings.
- Per-contact timeline: sent, opened, clicked, replied, bounced, unsubscribed, SMS reply, call, task, card sent.
- Reply inbox grouped by intent: interested, asks pricing, asks insurance, asks service area, asks for card, not interested, unsubscribe, wrong person, human review.
- Batch receipts saved to a durable file/table.
- City and category performance: send count, reply count, positive replies, opt-outs, bounces, opportunities, quotes, booked jobs.

## Event Pipeline

Every provider event must become a durable CRM event.

Events to store:

- `email_queued`
- `email_provider_accepted`
- `email_delivered`
- `email_opened`
- `email_clicked`
- `email_replied`
- `email_auto_replied`
- `email_bounced`
- `email_complained`
- `email_unsubscribed`
- `email_account_error`
- `campaign_completed`
- `lead_interested`
- `lead_not_interested`
- `lead_wrong_person`
- `lead_meeting_booked`

Event handling rules:

- Webhooks are at-least-once and may arrive out of order, so dedupe by provider event ID and sort by provider timestamp.
- A reply, unsubscribe, complaint, or bounce should pause future sequence jobs before any next send.
- Opens and clicks are engagement signals, not consent. They should affect scoring and prioritization, not trigger aggressive same-day follow-ups.
- Auto-replies should pause or delay the sequence depending on message content.
- Account errors should pause the sender account and alert an operator.

## Read Receipts And Tracking

"Read receipts" in outreach tools usually means open tracking, not a guaranteed human read. Open tracking depends on a tracking pixel and can be blocked or inflated by privacy tools.

Use opens this way:

- Good for directional engagement.
- Good for prioritizing later follow-up.
- Not proof that the person read or understood the email.
- Do not tell a prospect "I saw you opened my email."

Use clicks this way:

- Stronger than opens.
- Useful when someone clicked a rate card, digital card, quote link, or partner package.
- Still do not make the message creepy. Say "wanted to keep this handy" instead of referencing the click.

## Near-Term Build Order

1. Keep SMS revival running in controlled batches and keep documenting reply patterns.
2. Create the email campaign model in the CRM, independent of provider.
3. Add an email campaign builder that can produce previewable batches for law firms, designers/stagers, and insurance agents.
4. Add cross-channel suppression checks before every email send or provider sync.
5. Add email verification/enrichment status before high-volume sends.
6. Add SES adapter after the outreach domain is verified and SES production access is approved.
7. Add Sendy adapter only if we want to mirror selected lists/campaigns into Sendy for low-cost newsletter/autoresponder workflows.
8. Add a unified reply queue so email replies and SMS replies use the same playbook and action lanes.
9. Keep Instantly integration as an optional provider adapter, but do not block the email operating system on Instantly.

## Do Not Scale Until

- The sending domain/mailbox is verified and warmed.
- Resend/SES provider events are flowing into CRM, or Instantly/equivalent is active if using a managed cold-outreach platform.
- Opt-out/unsubscribe is cross-channel.
- Bounces are recorded and suppressed.
- Reply classification is visible in the partner workspace.
- Every campaign has city/category/message-version reporting.
- Dexa sender identity is configured before any Ottawa/Dexa email sends.
