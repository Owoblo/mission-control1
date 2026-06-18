# Saturn Star Movers Partnership Relationship Playbook

Last updated: June 18, 2026

This document describes the partnership inbox logic used for realtor and local partner outreach in Saturn Star OS. It is meant to be the working playbook for manual approval, AI draft generation, future automation, and training against real inbound SMS conversations.

## Core Goal

The goal is to turn interested or semi-interested partner replies into a useful relationship touchpoint without sounding automated, pushy, or spammy.

The ideal outcome is one or more of these:

- Send the partner a permission-based digital package.
- Give the partner a simple quote link or referral link they can forward to clients.
- Arrange a postcard, flyer, or business card drop-off at the right office/address/time.
- Send the package by email when requested.
- Capture partner intent, contact info, preferred location, and delivery instructions in the CRM.
- Move warm contacts from inbox/follow-up into an active partner pipeline when they become useful referral partners.

The system should answer the person first, then guide the conversation toward the next best touchpoint.

## Relationship Principles

- Human first: reply like Hunter or the local team is having a real conversation.
- Direct answer first: if they ask for an email, website, social page, phone number, pricing, proof, or whether this is Hunter, answer that before asking anything else.
- Permission-based links: do not drop digital package links into every conversation. Ask if it is okay unless they directly requested or approved the link/package.
- One clean CTA: ask no more than one or two questions in a draft.
- Use the first name naturally: include their first name when it sounds normal, usually once at the beginning.
- Keep locality correct: do not mention the wrong city or imply Windsor when the contact is London, Waterloo, Kitchener, Guelph, Chatham, or another market.
- Do not imply Hunter personally visits every office. For postcard or flyer drop-offs, use "I will make arrangements to drop it off." For meetings, say the meeting will be coordinated with a relationship manager or local team member.
- No AI tells: never mention AI, automation, prompts, or internal confidence.
- Do not invent facts: no invented rates, referral percentages, service areas, names, client examples, delivery status, or meetings.

## Digital Package

The digital package is the main asset we want permission to send. It should contain:

- The partner's referral link or quote link.
- Flyer/business card content.
- Rate card or pricing overview.
- Referral program details.
- Contact email and website.
- Social media links.
- Recent client feedback, reviews, or referral examples when available.
- City-localized phone number and market context.
- A form or quote path that stores the partner attribution in the CRM.

Generated package defaults are built from:

- `PARTNERSHIP_DIGITAL_PACKAGE_URL`, if configured.
- Otherwise `https://starmovers.ca/partner/{partner-slug}?city={market}`.
- Referral/quote fallback: `https://starmovers.ca/quote?ref={partner-slug}&market={market}`.
- Flyer fallback: `https://starmovers.ca/partner/flyers/{market}.pdf`.

Only `starmovers.ca` and `go.quote2move.com` should be used for this flow. Do not use or reference unrelated domains.

Phase 2 automation blocker:

The digital package must exist as a reliable artifact before package-sending automation is widened. Until then, package-link sends should remain manual-approved or limited to contacts where the package URL is known and complete.

Canonical package content:

- Partner-specific greeting and referral code.
- City-specific service area and local phone context.
- Forwardable client quote link.
- Realtor/partner referral form.
- Client-facing moving quote form.
- Flyer/business card download.
- Rate card or pricing overview.
- Referral incentive terms, only once final and approved.
- Social media links.
- Reviews, testimonials, or recent client feedback.
- Business contact email and website.
- Internal attribution metadata for CRM tracking.

## Referral Codes And Links

Referral links should be short, human-readable, and tied to the CRM partner record. The visible code should be shorter than a long slug when possible, but the backing link can still carry the full tracking value.

Recommended pattern:

- Human code: first name or last name plus market if needed, such as `ROSE-WIN`, `RAMI-WIN`, `MIKE-KW`.
- Link slug: stable partner slug, such as `/partner/rose-windsor` or `/quote?ref=rose-win&market=windsor`.
- CRM field: store `referral_partner_code` as a real field when a referral form or quote is submitted.

## Market And Locality

Market inference currently uses contact city, company, and tracking code.

Default markets:

- Windsor: fallback market.
- London: London, St. Thomas, Woodstock, Strathroy, Sarnia, Ingersoll, Tillsonburg.
- Waterloo/Kitchener: Kitchener, Waterloo, Cambridge, KW, Elmira, Brantford, New Hamburg, Ayr.
- Guelph: Guelph, Fergus, Elora, Wellington.
- Chatham: Chatham.

When the contact gives a brokerage location by name, such as "Royal LePage on Provincial," treat that as a usable location hint instead of asking for a full street address immediately.

## Inbox Workflow

The partnership inbox should help the operator see:

- Contacts that have responded and need a reply.
- Contacts that already received a response.
- Contacts that are waiting on follow-up.
- Contacts ready for postcard/flyer drop-off.
- Contacts ready for digital package send.
- Contacts ready to become active partners.

After an outbound SMS is sent, the same draft should not stay as an active "Use draft" action if it would resend the exact same message. If a new inbound arrives, the thread should move back into the needs-response state.

Recommended stages:

- `unread`: new inbound needs review.
- `open`: active conversation in progress.
- `follow-up`: outbound sent, waiting for response or next scheduled action.
- `booked/drop_cards`: delivery or meeting needs logistics.
- `partners`: warm/active partner relationship.
- `closed_lost`: opt-out, wrong number, not interested, or dead end.

## Conversation State Object

Every draft should be generated from a consistent state object, not only the latest inbound text. This prevents mistakes like asking for package permission again after the partner already said digital is good and provided an email.

Recommended shape:

```json
{
  "contact_id": "contact_123",
  "contact_name": "Rose Laflamme",
  "company": "Jump Realty Inc.",
  "market": "windsor",
  "stage": "open",
  "last_inbound_text": "Is this Hunter?",
  "last_outbound_text": "Is it okay if I send the full digital package here too?",
  "thread_summary": [
    "Outbound asked permission to send digital package",
    "Partner said digital is good and provided rose@jumprealty.ca",
    "Partner asked if this is Hunter"
  ],
  "package_permission_granted": true,
  "package_sent": false,
  "email_on_file": "rose@jumprealty.ca",
  "brokerage_location": null,
  "delivery_address": null,
  "delivery_time_window": null,
  "delivery_instructions": null,
  "latest_intents": ["confirms_identity"],
  "risk_flags": []
}
```

Minimum context window:

- Latest inbound message.
- Last outbound message.
- Last 2-3 conversational turns.
- CRM stage and decision.
- Package permission status.
- Package sent status.
- Email on file or email found in recent thread.
- Delivery address/location/time if already provided.

The current code passes recent thread context to AI refinement and uses prior touches for permission checks. The playbook should keep pushing toward this formal state object so the UI, rules, and AI all reason from the same facts.

## Multi-Intent Priority

Real SMS replies often contain more than one intent. The assistant should not choose only the easiest label and ignore the rest.

Priority order:

1. Safety and consent: opt-out, wrong number, not interested.
2. Direct factual question: identity, phone number, email, website, social media, pricing, referral program, proof/references.
3. Explicit request: send card/flyer, send package, send by email.
4. Logistics already provided: address, brokerage location, time window, delivery instruction.
5. Relationship goal: ask permission for digital package, referral link, or drop-off arrangement.
6. Ambiguity handling: ask one clarifying question or mark for human review.

Examples:

- If they ask for social media and give the brokerage location, answer social media first, acknowledge the location, then ask package permission.
- If they ask pricing and give an address, answer pricing with the rate card/package, then confirm drop-off timing.
- If they say digital is good and provide email, treat package permission as granted and avoid asking for postcard logistics again.

## Timing Rules

Use human timing instead of instant robotic sends.

- Business hours preferred.
- If after roughly 6:00 PM local time, schedule non-urgent replies for the next business day.
- Urgent client/move questions can be faster.
- Normal draft sends can wait a few minutes to feel human.
- Keep early automation manual-approved until a response class has been proven safe.

## Confidence And Send Policy

Use confidence to decide whether a reply can be automated or must stay manual-approved.

### Auto-Send Safe

Only consider auto-send when all are true:

- Intent is high-confidence and low-risk.
- No invented facts are needed.
- No link is included unless permission is granted.
- Latest inbound clearly matches a proven pattern.
- Prior context is not contradictory.
- Message is short, direct, and has one clear CTA.

Examples:

- Opt-out acknowledgement.
- Wrong-number acknowledgement.
- Sending package after explicit "yes, send it" to a package-permission question.
- Confirming a public email/website without links.

### Queue For Review

Keep manual approval when:

- The reply combines multiple intents.
- The partner asks about pricing, references, social proof, commission, or service area.
- The assistant needs to infer a brokerage location.
- They gave a vague positive like "OK," "go ahead," or an iPhone reaction.
- The draft asks for address/time or package permission.

### Block Until Human Approves

Do not auto-send when:

- The message is angry, confused, legal/compliance-sensitive, or very ambiguous.
- The system lacks recent thread context.
- The package link is not configured.
- The partner asks for specific rates, payout terms, or client proof that is not verified.
- The response would mention a delivery, appointment, or sent package that has not actually happened.

## Intent Categories

The code classifies inbound SMS into these intent buckets.

### `postcard_yes`

They agree to cards/postcards/flyers or say yes after we asked to drop something off.

Draft goal:

- Thank them.
- Ask for best address and time, unless already provided.
- Ask permission to send the digital package.

Example:

`Perfect, thanks Rose. I will make arrangements to drop it off. What address and time work best? Is it okay if I send the full digital package here too? It has your referral link, flyer/business card, referral details, and a client quote link you can forward anytime.`

### `drop_by_anytime`

They say to leave cards at reception, front desk, mailbox, drop box, or office.

Draft goal:

- Acknowledge the instruction.
- Do not over-ask if a usable location is already there.
- Ask for time only if useful.
- Ask permission to send the digital package.

If they mention low sales activity or a changed role, keep it low pressure.

Example:

`Totally understand, Kevin, no pressure at all. We can leave a few cards at reception. If anything comes up later, even one client is helpful. Is it okay if I send the full digital package here too?`

### `send_card_or_flyer_media`

They ask for a card, business card, flyer, picture, photo, image, or graphic by text.

Draft goal:

- Confirm we can text the card/flyer.
- Ask permission to send the full digital package too.
- Do not ask for office logistics unless they ask for physical drop-off.

Example:

`For sure Barbara, I can text the card/flyer here. I also have the full digital package with rates, referral info, and your client quote link in one place. Is it okay if I send that here too?`

### `digital_only_no_postcard`

They say they are not in the office, do not want postcards, or only want digital/email/link info.

Draft goal:

- Respect the digital-only preference.
- Do not push physical delivery.
- Ask permission to send package if not already granted.

Example:

`No problem Simon, digital is perfectly fine. Is it okay if I send the full digital package here too? It has your referral link, flyer, and a client quote link you can forward anytime.`

### `asks_contact_info`

They ask whether this number can be shared with clients, or ask for company email, website, phone, or URL.

Draft goal:

- Answer the factual question first.
- Give public email and website.
- Ask permission to send the package after answering.
- Do not ask for postcard address/time in this reply.

Default public email: `info@starmovers.ca`.

Default website: `starmovers.ca`.

Example:

`Absolutely Rami, yes, this number works for clients too, our email is info@starmovers.ca, our website is starmovers.ca. Is it okay if I send the full digital package here too? It has the flyer/business card, referral details, and a client quote link you can forward anytime.`

### `confirms_identity`

They ask "Is this Hunter?" or similar.

Draft goal:

- Answer identity directly.
- If they already approved digital and provided email, acknowledge the email and package plan.
- Do not restart address/time questions.

Example:

`Yes Rose, this is Hunter. I saw your email too: rose@jumprealty.ca. I can send the digital package there and keep the link here as well so you have everything handy.`

### `asks_for_references`

They ask for recent client referrals, references, reviews, proof, testimonials, or examples.

Draft goal:

- Treat this as a credibility request.
- Say we can include recent client feedback or referral examples in the package.
- Ask permission to send it.
- Do not only ask for address/time.

Example:

`Absolutely Shaun. I can include recent client feedback and a couple of referral examples in the digital package, along with the flyer/business card and quote link. Is it okay if I send that here too?`

### `asks_for_email`

They ask to send the package/link/info by email or provide an email address for it.

Draft goal:

- If an email is present, confirm sending there.
- If no email is present, ask which email to use.
- Do not confuse this with `asks_contact_info`, where they ask for our public email.

Example with email:

`For sure Rose, I can send it to rose@jumprealty.ca. I will include the flyer, rate card, referral info, and client quote link.`

Example without email:

`Absolutely Mak, what email should I send it to? I can send a short package with the flyer, rate card, referral info, and client quote link. I can also text it here if that is easier.`

### `asks_for_pricing`

They ask what we charge, rates, pricing, cost, or fees.

Draft goal:

- Answer by pointing to rate card/package.
- Do not invent detailed pricing.
- Continue toward package and postcard delivery.

Example:

`For sure John. I can send over the digital package and rate card. It has the general rate card and referral details in one place. I will make arrangements to drop it off. What address and time work best?`

### `asks_referral_program`

They ask about commission, incentive, referral program, or payout.

Draft goal:

- Confirm there is referral info.
- Send/offer the referral program package.
- Continue toward drop-off logistics if appropriate.

Do not invent a final payout amount unless it is configured and approved.

### `asks_social_media`

They ask for Instagram, Facebook, LinkedIn, social media page, or social proof.

Draft goal:

- Answer yes.
- If brokerage location is present, acknowledge it.
- Ask permission to send package with social links included.

Example:

`Absolutely Natalie, yes we do. Royal LePage on Provincial works. I will make arrangements to drop it off. Is there a time this week that is best? Is it okay if I send the full digital package here too? It has our social links, flyer/business card, referral details, and a client quote link you can forward anytime.`

### `wants_meeting`

They ask to meet, call, book an appointment, or have someone come by.

Draft goal:

- Coordinate a relationship manager or local team member.
- Ask for time/address if missing.
- Do not imply Hunter personally attends unless true.

Example:

`That works Mak. I can coordinate one of our relationship managers to stop by. What time and address work best? Is it okay if I send the full digital package here too?`

### `gives_address`

They provide a street address or clear office location.

Draft goal:

- Repeat the address back.
- Ask for time or front desk/reception permission.
- Ask permission to send the package.

### `gives_time_window`

They provide timing.

Draft goal:

- Confirm the time.
- Ask for address if missing.
- Ask permission to send the package.

### `warm_acknowledgement`

They send "thanks," "thank you," "sounds good," "no problem," a short positive message, or an iPhone reaction like "Loved your SMS."

Draft goal:

- Avoid over-reading.
- If package permission was already granted, send package.
- If not, ask a light next question.
- For pure iPhone reactions, keep it manual review or light follow-up.

### `positive_vague`

They say "go ahead," "OK," "yes," "sure," or another ambiguous positive.

Draft goal:

- Look at prior outbound context.
- If prior message asked for package permission, send package.
- If prior message asked about postcard drop-off, ask for address/time and ask package permission.
- If context is unclear, draft reply but flag for review.

### `not_interested`

They decline.

Draft goal:

- Acknowledge respectfully.
- Do not keep pitching.
- Mark closed lost or not interested.

Example:

`No problem at all, thanks for letting me know.`

### `wrong_number`

They say wrong number/person.

Draft goal:

- Apologize.
- Update list.

Example:

`Sorry about that, I will update our list.`

### `stop_opt_out`

They opt out or ask not to be contacted.

Draft goal:

- Confirm no more texts.
- Mark opted out.

Example:

`No problem, I will make sure we do not text you again.`

### `needs_human_review`

No usable inbound text or risk is too high.

Draft goal:

- Do not auto-send.
- Human reviews full thread.

## Permission Logic

The system may send package links when:

- They directly ask for package/link/info/rates/referral details.
- They ask for pricing or referral program details.
- They ask for references/reviews/recent client examples.
- They provide an email and ask to receive the package/info there.
- Prior outbound asked permission and their latest inbound says yes, sure, go ahead, send it, okay, that works, etc.
- They previously approved digital and then ask a follow-up like "Is this Hunter?"

The system should not send package links when:

- They only say "thanks" or react with a love/like.
- They only agreed to postcard drop-off.
- They ask for our public email/website/number but have not approved the package.
- They ask an unrelated question.
- The reply is too short or ambiguous and prior context is unclear.

## Silence And Follow-Up Logic

The current playbook starts the relationship, but follow-up rules should be explicit so the system does not chase people too aggressively.

Recommended timing:

- If a partner says "drop by anytime" and cards are not logged as delivered, create a delivery task and do not send another sales-style SMS immediately.
- After cards are delivered, send one light confirmation/update if appropriate.
- If a digital package was sent and there is no response, wait several business days before a soft check-in.
- If they only gave a warm acknowledgement, do not chase aggressively.
- If they asked for email/package and we sent it, one follow-up is enough unless they re-engage.

Example post-delivery update:

`Hi Natalie, just confirming we dropped the cards at the front desk. Appreciate you keeping us in mind if any clients need movers.`

Example package follow-up:

`Hi Rami, just wanted to make sure the package came through. No rush at all, but you can use that link anytime a client asks for moving help.`

## Guardrails For AI Drafts

AI can improve phrasing, but it must stay inside these guardrails:

- No links unless package permission is granted.
- No URLs outside the allowed package/rate/referral/flyer config.
- No invented rates or payout terms.
- No invented proof, testimonials, reviews, or named clients.
- No "I will personally stop by" language.
- No AI/automation language.
- No long multi-question messages.
- Keep SMS under roughly 420 characters when possible.
- If unsure, recommend human review.

## Examples From Current Batch

### Rami: asks number/email/website

Inbound:

`Hi Hunter, thanks for reaching out. I'm not usually in the office. But I'll keep your number handy on my phone. Is this the number I can share with clients? And do you also have an email or website? Thanks`

Best response:

`Absolutely Rami, yes, this number works for clients too. Our email is info@starmovers.ca and our website is starmovers.ca. Is it okay if I send the full digital package here too? It has the flyer/business card, referral details, and a client quote link you can forward anytime.`

Reason:

He asked a direct contact-info question. Do not ask what email to send it to first.

### Rose: digital approval, email, then identity

Inbound:

`Digital is good. My email rose@jumprealty.ca`

Then:

`Is this Hunter?`

Best response:

`Yes Rose, this is Hunter. I saw your email too: rose@jumprealty.ca. I can send the digital package there and keep the link here as well so you have everything handy.`

Reason:

She approved digital and provided email. Do not ask for address/time again.

### Shaun: asks for recent client referrals

Inbound:

`Absolutely. If you could add a couple referrals of recent clients, that would be great as well`

Best response:

`Absolutely Shaun. I can include recent client feedback and a couple of referral examples in the digital package, along with the flyer/business card and quote link. Is it okay if I send that here too?`

Reason:

He is asking for credibility/proof. Handle that before drop-off logistics.

### Kevin: not selling much

Inbound:

`You can drop off cards to reception at Valente Real Estate on Dougall. I have a different position at the company an not selling very much`

Best response:

`Totally understand, Kevin, no pressure at all. We can leave a few cards at reception. If anything comes up later, even one client is helpful. Is it okay if I send the full digital package here too?`

Reason:

Keep the relationship alive without pressuring them.

### Natalie: social page plus brokerage location

Inbound:

`Hey! Always open to new business and we always need movers! You certainly can. It's the Royal LePage on Provincial. Do you have a social media page`

Best response:

`Absolutely Natalie, yes we do. Royal LePage on Provincial works. I will make arrangements to drop it off. Is there a time this week that is best? Is it okay if I send the full digital package here too? It has our social links, flyer/business card, referral details, and a client quote link you can forward anytime.`

Reason:

Answer social media, use the brokerage location, and keep moving toward package/drop-off.

## CRM Data To Capture

Each partnership thread should support these fields:

- Contact name.
- Company/brokerage.
- Phone.
- Email.
- City/market.
- Industry/profession.
- Current stage.
- Decision/outcome.
- Tracking code.
- Referral partner code.
- Digital package URL.
- Quote/referral URL.
- Preferred delivery address.
- Brokerage location hint.
- Delivery time window.
- Delivery instructions.
- Whether package permission was granted.
- Whether package was sent.
- Whether physical cards/flyers were requested.
- Whether social media/contact info/pricing/references were requested.
- Last inbound timestamp.
- Last outbound timestamp.
- Needs human review flag.

## Native Referral Endpoint

The bigger picture is to move referral form submissions into a native CRM endpoint instead of forwarding everything through the general quote capture path.

Recommended endpoint:

`/api/partners/referral-capture`

It should store:

- `referral_partner_code`
- `partner_id`
- `market`
- `client_name`
- `client_phone`
- `client_email`
- `move_from`
- `move_to`
- `move_date`
- `submitted_by` as partner, client, or internal
- `source_url`
- `utm/ref` metadata

This lets sales see which partner produced which lead and avoids losing attribution.

## Automation Rollout

Start manual, then automate safe classes.

Phase 1:

- Generate drafts only.
- Human clicks Use Draft / Send.
- Log which drafts were approved or edited.
- Add new edge cases from real messages.

Phase 2:

- Auto-send only high-confidence, low-risk replies.
- Examples: confirmed package permission, explicit card request, opt-out acknowledgement.
- Keep package links permission-based.
- Keep business-hours scheduling.

Phase 3:

- Auto-create delivery tasks.
- Auto-send package email when email is provided and permission exists.
- Auto-move contacts to partner pipeline after package sent or first referral captured.
- Track response outcomes by city, batch, wording, and partner type.

## Current Code Surface

Main logic:

- `lib/server/partnership-reply-assistant.ts`

Main inbox UI:

- `app/marketing/partners/page.tsx`

SMS replies API:

- `app/api/marketing/sms/replies/route.ts`

Referral capture endpoint:

- `app/api/partners/referral-capture/route.ts`

Notification recipients:

- `lib/server/internal-notifications.ts`

Logic tests:

- `tests/logic/partnership-reply-assistant.test.ts`

## Roadmap

### Quick Wins

- Prevent stale drafts from staying visible after an SMS is sent.
- Make the SMS composer taller and easier to review.
- Add UI filters for unread, responded, follow-up, drop cards, ready to send package, and partners.
- Add short referral code generation.
- Add package send status directly to partner contacts.

### This Sprint

- Store `referral_partner_code` as a first-class field on referral leads.
- Add social links, client reviews, and city flyers into the digital package.
- Add city-specific package copy and local phone numbers.
- Add MMS/media support checks for Twilio numbers and store inbound/outbound media URLs.
- Formalize the conversation state object in the API response.

### Future

- Add delivery-driver task flow: assigned rep, drop location, photo proof, delivered timestamp, and optional follow-up SMS.
- Build a feedback loop from approved/edited drafts into better playbook examples.
- Add batch-level analytics by city, profession, reply intent, package send rate, drop-off completion, and referral conversion.
- Expand the same framework to interior designers, storage companies, lawyers, corporate accounts, email outreach, and direct mail.
