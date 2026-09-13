# SES Outreach Domain Setup

Domain: `saturnstarmovers.ca`

Use this domain for cold partnership outreach only. Keep customer booking, quote, and operations email on the main business mailboxes so cold outreach cannot damage core customer deliverability.

## Secure credential handoff

Do not paste AWS secret keys into chat. Add them to the app environment instead:

```env
PARTNERSHIP_EMAIL_PROVIDER=ses
PARTNERSHIP_EMAIL=john@saturnstarmovers.ca
PARTNERSHIP_EMAIL_REPLY_TO=john@saturnstarmovers.ca
AWS_REGION=us-east-2
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SES_CONFIGURATION_SET=saturn-partnership-outreach
AWS_SES_OUTREACH_DOMAIN=saturnstarmovers.ca
```

Use an IAM user or role scoped to SES sending and SES identity/configuration management. Do not use the AWS root user.

## DNS records to prepare

SES will give exact DKIM CNAME records after the domain identity is created. Publish those exact records in the DNS host.

Minimum records:

- MX for inbound mail if we receive replies on this domain.
- SPF including SES.
- DKIM records from SES.
- DMARC record for `_dmarc.saturnstarmovers.ca`.
- Custom MAIL FROM domain, usually `bounce.saturnstarmovers.ca`.
- Tracking domain if we enable SES open/click tracking.
- Public unsubscribe endpoint for one-click unsubscribe before scaling.

Suggested starting DMARC policy while testing:

```text
v=DMARC1; p=none; rua=mailto:dmarc@saturnstarmovers.ca; adkim=s; aspf=s
```

Tighten the policy only after SPF/DKIM alignment and clean sending are confirmed.

## Current SES status after Cloudflare DNS verification

Updated September 11, 2026:

- Active outreach domain: `saturnstarmovers.ca`.
- Recommended sender: `John <john@saturnstarmovers.ca>`.
- SES region: `us-east-2`.
- SES identity verification: success.
- SES DKIM: success.
- SES custom MAIL FROM: success for `bounce.saturnstarmovers.ca`.
- SES account health: healthy.
- SES production access: requested, but AWS returned DENIED for case `178909688600897`. We need to appeal/resubmit with stronger account/use-case details before sending to unverified real recipients.
- Current sandbox quota after denial: 200 messages/day, 1 message/second, simulator/verified-recipient sending only.
- SES test send to the AWS mailbox simulator succeeded.
- SES EventBridge event destination exists for send, delivery, open, click, bounce, complaint, reject, delivery delay, and subscription events.
- Direct SNS-to-CRM webhook still needs SNS permission if we want SES to POST directly to `/api/marketing/email-events/ses`.

## SES setup checklist

1. Create a SES domain identity for `saturnstarmovers.ca`.
2. Publish SES DKIM records in DNS.
3. Configure a custom MAIL FROM domain.
4. Request SES production access.
5. Create the `saturn-partnership-outreach` configuration set.
6. Add event destinations for send, delivery, open, click, bounce, complaint, delivery delay, and subscription/unsubscribe events.
7. Point events into Saturn CRM through SNS/EventBridge/Lambda or a webhook bridge.
8. Add account-level suppression for bounces and complaints.
9. Start with a small test batch before any large campaign.

## First safe ramp

- Day 1: 25-50 emails total.
- Day 2-3: 50-100/day if bounces and complaints stay clean.
- Week 1: keep it under a few hundred/day while reply handling is verified.
- Scale only after DNS, events, bounce suppression, reply matching, and unsubscribe are working.
