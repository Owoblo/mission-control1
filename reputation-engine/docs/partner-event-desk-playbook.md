# Partner Event Desk

Owner instruction, October 9: connect events to Partnerships now; do not send event-based outreach yet. The GTA scrape will be run separately by John. Existing introduction/reply operations remain separate from this event work.

## Operator request: “Review our events”

1. Read `/api/marketing/listing-activity` for source-backed property/person associations, and research queue coverage. Group by person; preserve co-agents and roles. Sort observed property count or latest observation, and filter city/lane. These are observed inventory counts, not proven sales, revenue or a full market census.
2. Inspect each property source and listing/MLS/date. A disappeared advertisement can be withdrawn, expired or relisted. Only `confirmed_sale` is a sold milestone. Source-observed time is not the sale date, listing date or evidence of new motion.
3. For existing partners, read `/api/marketing/listing-activity/brief?contact=UUID`. This combines the event with shared Sales and Partnership messages/calls, ownership, outstanding tasks and card evidence. A recent conversation, unfulfilled promise, Sales ownership or suppression takes priority over a new pitch.
4. For unknown people, keep a source-backed candidate or paused discovery. Names or matching brokerage alone do not justify a merge. Conflicting/shared phones and emails require identity review. A property may have several representatives; never infer a buyer's agent or open-house host from a listing agent.
5. Choose one useful purpose for the person. Multiple alerts are context for one considered conversation, not multiple texts. Record missing evidence and a suggested next action. No sending or scheduling in this phase.

## Relationship-specific writing

- New person: introduce John once with a relevant, verified professional reason and one invitation.
- Previously contacted without reply: use a genuinely new reason; do not pretend there was a relationship or chase an old card offer.
- Card requested: continue naturally. Distinguish requested, sent, delivered and acknowledged; a media send alone proves none of the others.
- Engaged/referring partner: use known interests and actual history; avoid repeating questions or exposing private client details.
- Active move/Sales handoff: coordinate with the assigned rep. The partner and their moving client are distinct people.
- Unresolved issue/promise: fulfil or repair the commitment first.
- Declined/opted out/will initiate: retain the event as context without reviving outreach.

Proactive planning uses a seven-day recent-outbound hold for review. This does not prohibit answering an inbound or fulfilling a promise, and is not a new automated cadence. Context is re-read when the brief opens; a saved/exported brief is not a send authorization.

## Event concepts

| Event | Useful approaches | Evidence or fulfilment checks |
| --- | --- | --- |
| Just listed | Relevant congratulations; staging support; open-house help | New versus relisted, exact property, representative role |
| Confirmed sale | Closing-to-moving coordination; practical client resources | Sale evidence; no assumed closing date or moving need |
| Listing disappeared | Research sale/withdrawal/expiry/relist | No sold congratulations |
| Open house | Pizza/drinks; a welcomed rep visit; useful cards/checklists | Actual host/date, budget, delivery capacity and permission; food permission is not card-distribution permission |
| Professional event | Topic-specific introduction or meeting | Attendance, availability and sponsorship must not be invented |
| Completed referred job | Thank the partner, ask what could improve, resolve concerns | Actual completion and feedback, not dispatch/review-request status |

Use John only. No fabricated personal familiarity, transaction results, budgets, discounts or availability. Pricing depends on scope, route, floors/access and packing; offer a flat binding estimate after review. Owner-confirmed coverage includes GTA, Orangeville, Vaughan, Barrie, Georgina and Brock Township.

## Sources and expansion

Sold2Move's `partner_listing_activity` and `partner_listing_research` are reused. `refresh-partner-listing-inventory.cjs` reads stored inventory across configured regions independently of postcard eligibility. It does not scrape, pay for research, print, send messages or enqueue outreach. Default preview; explicit `--apply` saves internal associations and paused source-backed discoveries. Unknown cities are reported and held. The internal workflow runs after successful main-branch inventory/postcard runs and can be manually previewed.

`MarketEvent` and `planPartnerEvents` are the category-independent adapter/planner. Future open-house, event and service-outcome connectors must supply stable event keys, observed/occurred times separately, person/role/source evidence and verification status. Those connectors are not installed by this change. Mortgage brokers/interior designers use the same relationship/context rules with category-specific useful offers.

## Outcome discipline

Property activity → verified person association → relationship action → partner reply → actual client enquiry → quote → booked/completed job → repeat referral. Keep each step separate. Food delivery, a card, a task or a reply is not a booked job. Preserve evidence, open fulfilment and ownership rather than rewarding raw message volume.
