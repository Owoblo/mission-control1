# Saturn Star Experience Architecture Audit

> **Saturn Star’s software is not a collection of features. It is the operational environment through which the company thinks, communicates and performs. The experience must make work easier to understand, easier to complete, easier to recover and harder to forget.**

Audit date: 2026-07-19  
Production reviewed: `https://go.quote2move.com`  
Brand source: Saturn Star Master Brand System Playbook v1  
Audit standard: **Does this feature absorb complexity and return a clear, safe and human next action?**

## Executive finding

Saturn Star already has considerably more operational depth than a conventional CRM: unified lead history, quote and job linkage, call recording and transcription, warm transfer, voicemail, city-aware access, readiness, dispatch, crew execution, payments, partnerships, academy, automation, and reporting. The product is not missing its operating spine.

The principal problem is that the interface exposes the accumulated machinery more readily than it absorbs it. Capability is ahead of experience architecture. The system is strongest at continuity and operational breadth; it is weakest at role-fit, accessibility, action hierarchy, progressive disclosure, and explicit recovery.

The July command-system work materially improved the top-level model: Capture → Understand → Price → Confirm → Prepare → Execute → Close → Learn. The next phase should consolidate duplicate surfaces, make readiness and exceptions authoritative, and turn the dialer/inbox/job record into context-preserving workspaces.

### Evidence snapshot

- 39 application page routes and 176 API routes inventoried.
- 35 representative routes exercised on production at 1440×1000 and 390×844: 70 rendered observations.
- 32 permission probes across owner, manager, sales representative, operations lead, crew, and partnership manager roles.
- No page-level horizontal overflow was detected at 390px.
- 10 rendered observations generated console resource errors.
- Referral Partners and Mark Job Complete exposed the same production 500 caused by a null legacy partner field.
- 9 route families rendered without a visible `h1` during the observation window.
- 16 observations included unnamed form controls; Settings included eight unnamed icon buttons.
- Most authenticated screens had more than 80% of interactive controls below a 44×44 touch target. The global navigation is a major contributor, but dense queues also fail independently.
- Partnership pipeline took 9.6 seconds in the desktop observation; several data-heavy views remained in a loading state when the structural capture occurred.
- Permission redirects correctly prevented broad cross-role access in tested routes, but operations leads and crew resolve to the same calendar environment, limiting role specialization.

Raw evidence is stored in `docs/audit-evidence/browser-audit.json`; screenshots are in `docs/audit-evidence/screenshots/`.

## Severity model

| Severity | Meaning | Response |
|---|---|---|
| S0 | Data loss, unsafe money state, privacy breach, or uncontrolled destructive action | Stop work and correct immediately |
| S1 | A core journey fails, status is dangerously ambiguous, or context is lost | Correct before further cosmetic work |
| S2 | Frequent friction, accessibility failure, duplicate work, or role mismatch | Current redesign tranche |
| S3 | Consistency, polish, or lower-frequency inefficiency | Design-system backlog |

## 1. Experience map

```text
DEMAND                         DECISION                         DELIVERY
Website / call / SMS / email   Qualification / estimate        Readiness / dispatch
Partner / repeat / manual  →   quote / revision / deposit  →   field execution
        │                              │                              │
        └──── identity + consent ──────┴──── one job spine ──────────┘
                                                                       │
CARE & LEARNING                                                         ▼
Receipt ← payment ← completion ← crew closeout ← incidents / changes
   │
   ├─ review / referral / partner update
   ├─ claim / repair / refund
   └─ actuals → estimate, capacity, training, attribution, margin
```

The authoritative object should be the job spine, not a contact or a disconnected pipeline card. A person can have several opportunities and jobs; communications must attach to the person and, when known, the relevant job. Every threshold must record actor, time, source state, destination state, and unmet dependencies.

### Journey findings

| Journey | Current strength | Structural gap | Target outcome |
|---|---|---|---|
| Unknown call → valid lead | Caller matching, inbound creation, recording, voicemail and queue paths exist | Spam explanation/review is settings-oriented; active-call context is thinner than the full data available | Identify, classify, attach, summarize and schedule without leaving call workspace |
| Lead → booked job | Strong lead, estimate, quote, payment and booked surfaces | Multiple pages express similar sales state; outstanding booking dependency is not always dominant | One objection/dependency, one next action, one visible threshold |
| Booked → ready | Readiness and job-spine helpers now exist | Booked and Operations still behave as sibling lists; readiness lacks one universal completion contract | A booked job cannot appear ready while a critical dependency is false |
| Moving day | Linear crew flow and event API exist | Crew and operations lead share calendar entry; offline recovery and interrupted-submit evidence remain incomplete | One-handed, resumable execution with explicit sync status |
| Completion → care | Payments, review jobs, partner proof and follow-up exist | Legacy Trigger flow duplicates job completion and failed because partner data failed | Completion event produces one closeout checklist and downstream tasks |

## 2. Role map

| Role | Primary question | Required home | Must not carry |
|---|---|---|---|
| Owner / branch owner | Where does leadership need to intervene across my authorized region? | Company pulse, exceptions, city health, live work, financial summary | Raw queues by default |
| Manager | What is blocked, unowned, conflicting, or deteriorating? | Exception command centre with ownership controls | Admin-only identity controls |
| Sales representative | Which customer needs contact or decision support now? | New/reply/callback/quote/deposit work queue | Crew and finance internals |
| Dispatcher | Can today’s work happen, and where is intervention needed? | Live jobs, crews, trucks, time variance, exceptions | Campaign and relationship detail |
| Operations lead | Is every assigned job genuinely prepared? | Readiness board, capacity, assignment conflicts | Sales analytics and admin |
| Crew lead | What is my next physical action on this job? | Today’s sequence and resumable job execution | Company-wide pipeline |
| Customer success | Which completed customer or partner needs care? | Unpaid, unresolved, feedback, claims, partner updates | Dispatch controls |
| Finance | What money is expected, received, disputed, or unreconciled? | Deposit/balance/refund/margin exceptions | Call controls |
| Partnership manager | Which partner promise or referral needs action? | Today, inbox, pipeline, visits, proof and partner outcomes | Consumer sales queues |

Observed permission behavior is directionally sound: prohibited top-level routes redirect to the role environment. However, route denial and role-fit are not the same. Crew and operations lead both land on `/crew/calendar`; leadership breadth is available, but a region-scoped branch owner needs a visibly persistent scope indicator and an audit trail when scope changes.

## 3. Information architecture

### Recommended environments

1. **Command** — live state, today, exceptions, pipeline summary, health.
2. **Intake** — inbox, calls, leads, referrals, duplicate/spam review.
3. **Sales** — opportunities, estimates, quotes, deposits, follow-up.
4. **Operations** — booked, readiness, capacity, schedule, dispatch.
5. **Live** — jobs in execution, crew communication, incidents.
6. **Care** — payments, claims, reviews, referrals, partner updates.
7. **Management** — finance, analytics, people, automation health, settings.

The grouped navigation now approximates this model, but legacy top-level `/partners` and `/trigger` flows overlap newer Partnerships and operational completion. They should be migrated, redirected, or explicitly labeled as legacy—not left as separate sources of truth.

### Object contract

Every important record header must expose: identity, city/scope, owner, state, risk, next action, last meaningful event, and money state where relevant. Technical identifiers and system metadata belong below this hierarchy.

## 4. Workflow audit

### Intake and inbox

- **Strength:** communication events and leads are connected; inbound call creation and phone matching are implemented.
- **S1:** Inbox rendered as “Loading lead inbox…” during the structural observation. Loading must use a stable skeleton with queue identity, retry, elapsed-state escalation, and preserved selection.
- **S2:** No visible page heading in the observed inbox DOM. A screen reader and a sighted user arriving through a deep link need the same identity.
- **S2:** Inbox should prioritize replies, missed calls, voicemail, unowned, aging, and suspected spam rather than a single chronology.
- **Target:** three-pane queue on desktop; list → conversation → action on mobile. Selected conversation retains customer/job header and composer outcome.

### Sales, estimate and quote

- **Strength:** lead and quote detail are connected and the job record header now carries operational state.
- **S1:** A quote threshold must disclose assumptions and the exact operational changes created by acceptance.
- **S2:** Quote detail had 61 of 65 mobile controls below 44px in the automated geometry pass.
- **S2:** Pipeline exposed seven form controls without programmatic names.
- **Target:** “What prevents booking?” is explicit on every opportunity. Send creates visible delivery evidence and follow-up. Acceptance creates a booking exactly once.

### Scheduling and dispatch

- **Strength:** capacity and dispatch logic exist; readiness now spans customer, financial, crew/equipment, and operations.
- **S1:** A readiness state needs server-enforced critical blockers, not a display-only checklist.
- **S2:** Booked and Operations need a shared schedule model to prevent contradictory state.
- **Target:** day cells show required versus assigned movers, drivers, trucks, duration, travel, revenue, and risk. Exceptions are a separate operational queue.

### Field operations

- **Strength:** the new sequential crew flow is the correct architectural direction.
- **S1 evidence still required:** airplane-mode start, photo queue, signature interruption, duplicate completion submission, and recovery after token expiry.
- **S2:** operations lead needs preparation and escalation tools distinct from crew execution.
- **Target:** every mutation shows local state, sync state, server acknowledgment and a safe retry path.

### Completion, payment and care

- **S1 fixed in source:** null partner data caused `/partners` and `/trigger` to show a 500-backed error. Shared normalization now tolerates historical nulls and exposes incomplete partners for repair.
- **S1:** payment UI must distinguish not attempted, processing, authorized, captured, failed, refunded, partially refunded, and reconciliation mismatch.
- **S2:** legacy “Mark Job Complete” independently creates a review job; completion should originate from the canonical job state and emit care work.
- **Target:** one closeout contract: job completion evidence, time, signature, final charge, receipt, partner update, feedback eligibility and unresolved issue state.

### Partnerships

- **Strength:** the redesigned relationship system contains today/inbox/pipeline/phone/visits/settings contexts and city-aware access.
- **S1:** phone and queue tabs emitted a missing-resource error; Twilio CDN requests were aborted during navigation. SDK loading must have one owner, one source and an explicit unavailable state.
- **S2:** partnership pipeline took 9.6 seconds in the desktop pass.
- **S2:** queue rendered roughly 680 controls, almost all below touch minimum. The surface requires virtualization and row-level progressive disclosure.
- **Target:** partner → referred client → quote → job → outcome → update → appreciation remains visible as one referral object.

## 5. Screen-level audit and scorecard

Scores use the requested 15 dimensions, maximum 75. They are evidence-based directional baselines, not claims of user-testing precision.

| Module / surface | Score | Band | Primary finding |
|---|---:|---|---|
| Command dashboard | 61 | Strong | Correct operational model; competing headings and small global controls |
| Inbox | 47 | Significant friction | Loading-state identity and prioritization are weak |
| Leads list | 55 | Structurally weak | Useful density; action/context hierarchy needs consolidation |
| Relationship / lead record | 62 | Strong | Three-zone relationship architecture is a major improvement |
| Sales pipeline | 51 | Structurally weak | State visible; seven unnamed filters and too many small controls |
| Follow-up | 54 | Structurally weak | Outcomes exist; task meaning and promise distinction need strengthening |
| Quotes list | 56 | Structurally weak | Scannable but exception/dependency cues need authority |
| Quote detail / estimate | 52 | Structurally weak | Operationally rich; mobile action density and assumptions hierarchy fail |
| Booked jobs | 55 | Structurally weak | Useful operational list; not yet one readiness authority |
| Operations / readiness | 60 | Strong | New readiness model is sound; needs enforced blockers and schedule unity |
| Ops SMS | 49 | Significant friction | No observed `h1`; channel context and delivery recovery need proof |
| Finance | 57 | Structurally weak | Money visible; reconciliation-state contract needs expansion |
| Live feed | 52 | Structurally weak | Activity exists; meaningful exceptions compete with normal events |
| Analytics | 50 | Structurally weak | No observed `h1`; needs decision-oriented definitions and drill-through |
| Reps | 49 | Significant friction | No observed `h1`; management action and coaching context are unclear |
| Team / users | 53 | Structurally weak | Permission boundary works; dense controls and auditability need attention |
| Settings | 44 | Significant friction | Eight unnamed buttons, five unnamed inputs, high destructive/configuration risk |
| Academy | 58 | Structurally weak | Strong path concept; one missing resource and content-heavy navigation |
| Dialer health | 59 | Structurally weak | Diagnostic depth is strong; routine user recovery needs simplification |
| Floating dialer / active call | 60 | Strong | Warm transfer, notes, queue and devices exist; context is under-composed |
| Spam / blocked callers | 58 | Structurally weak | API supports reversible unblock; needs dedicated review and reason evidence |
| Partnerships | 57 | Structurally weak | Deep capability; slow pipeline, missing resource, extreme queue density |
| Campaigns / queue / signals | 51 | Structurally weak | Operational volume dominates exception and result quality |
| Crew calendar | 55 | Structurally weak | Role-safe landing; dispatch/preparation and field execution are conflated |
| Crew live job | 63 | Strong | Linear mobile model is correct; offline/retry proof remains |
| Referral Partners (legacy) | 36 | Redesign required | Production data error; duplicate architecture and delete-only confirmation |
| Mark Job Complete (legacy) | 34 | Redesign required | Production data error and parallel completion source |
| Affiliate | 46 | Significant friction | Sparse identity and no observed `h1`; ownership unclear |
| Login | 55 | Structurally weak | Clear purpose; all controls below 44px in geometry pass |

Automatic failure was triggered by the partner-data 500. No evidence showed irreversible spam blocking: the blocked-caller endpoint supports `DELETE`, so the gap is discoverability and review workflow rather than recoverability in the data layer.

## 6. Dialer audit

### What exists

- Incoming and outbound browser calling with Twilio Voice.
- Phone/lead matching and branch caller profile.
- Mute, elapsed time, notes, call logging and call outcomes.
- Queue acceptance, cold transfer, conference/warm transfer and return-to-caller paths.
- Microphone/speaker selection, browser compatibility, token refresh, network diagnostics and stuck-call warnings.
- Recording callbacks, recording recovery, archival, transcription, voicemail and missed-call handling.
- Blocked caller API with add/list/remove and block attribution.

### Corrections

1. **Incoming context card (S1):** person/unknown, type, city, active job/opportunity, last meaningful interaction, outstanding issue, call frequency, spam reason, owner.
2. **One active-call composition (S1):** call controls fixed at top; purpose and current record in centre; notes/outcome/next action at side or bottom sheet. Do not expose general CRM navigation as the working surface.
3. **Transfer packet (S1):** recipient sees caller, transferring employee, reason, current issue, record link and notes written during the call before accepting.
4. **Outcome contract (S2):** connected/voicemail/no answer/wrong number/callback/qualified/quote/not interested/spam/blocked, followed by a recommended next step.
5. **Spam evidence (S2):** reason codes and confidence; dedicated review queue; unblock, restore to inbox and attach-to-record actions; audit actor/time.
6. **SDK reliability (S1):** remove competing CDN ownership and expose “calling unavailable—messages and records remain safe” with retry and diagnostics.
7. **Recording consent (S1):** persistent recording state and jurisdiction-appropriate notice; never imply audio exists until callback confirms it.

## 7. Notification audit

Notifications should be routed by consequence, owner and time horizon—not by feature. Recommended classes:

| Class | Examples | Delivery |
|---|---|---|
| Interrupt now | active incident, customer waiting, crew/truck critical delay, payment uncertainty during closeout | In-product + role escalation |
| Today queue | missed call, warm reply, deposit blocker, readiness exception, promise due | Work queue; optional digest |
| Monitor | cooling partner, capacity concern, quote aging | Dashboard section |
| Record only | ordinary status progression, successful automation | Timeline, no notification |

Every notification needs object, reason, owner, required action, deadline, deduplication key, acknowledgment and resolution. The current top-bar count is not sufficient as an operational contract.

## 8. Mobile-field audit

No route overflow at 390px is a positive baseline, but “fits” is not “field-ready.” Touch geometry is the largest observed cross-product defect.

- Global navigation and many data controls are 28–38px high.
- Quote detail, signals, activity, settings and partnership queue are particularly dense.
- Field tests still required: bright daylight, gloves, one hand, poor network, interrupted photo upload, app backgrounding, low battery, and screen zoom.
- Crew execution should cache the assigned job and current step, queue evidence locally, reveal unsynced count, and make repeated submission idempotent.
- Minimum: 44×44 target, 16px editable text to prevent mobile zoom, visible focus, large primary action, and no adjacent destructive/routine actions.

## 9. Accessibility audit

### Confirmed defects

- Missing visible `h1` in observed Inbox, lead detail loading state, quote detail loading state, Ops SMS, Analytics, Reps, Settings, Affiliate and partnership phone surface.
- Unnamed controls in Pipeline, Booked, Operations, Activity, Settings, partnership phone/queue and Trigger.
- Widespread sub-44px interactive targets.
- Icon-heavy navigation uses emoji/glyphs that can create inconsistent accessible speech.

### Required standard

- One programmatic page title and one `h1`; loading/error/empty states preserve both.
- Every control has a stable accessible name; every field has an associated label, description and error relationship.
- Keyboard order follows visual order; dialogs trap focus and return it to the invoker.
- `aria-live` is reserved for meaningful asynchronous result/status.
- Contrast is verified in semantic states, not only brand colours.
- 200% zoom and 320px reflow pass without loss of action.

## 10. Design-system audit

The brand playbook calls for controlled navy, warm white/ivory, charcoal, and restrained gold. The new CRM surfaces move in this direction, but legacy dark pages and newer calm surfaces coexist.

Create a single operational component contract:

- `RecordHeader`: identity, scope, state, owner, risk, next action.
- `ExceptionBanner`: reason, consequence, owner, resolution action.
- `AsyncState`: skeleton, delay escalation, retry, preserved data.
- `StateTransition`: before/after, dependency warning, confirmation.
- `ActionResult`: what happened, time, next event, undo where safe.
- `Promise`: specific action, reason, channel, timing, outcome, evidence.
- `TimelineEvent`: channel, actor, summary, meaning, commitment.
- `MoneyState`: expected, authorized, captured, refunded, disputed, reconciled.
- `SyncState`: local, uploading, confirmed, failed, retrying.

Gold is selection/milestone emphasis, not a universal button colour. Red is reserved for failure, blocked work or real safety/compliance risk. Hierarchy must survive grayscale.

## 11. Error and recovery audit

| Failure | Required response |
|---|---|
| Collection load fails | Keep page identity and stale data if available; plain-language cause; retry; support reference |
| Save fails | Preserve input; identify unsaved fields; retry without duplicate creation |
| Call SDK fails | Preserve notes/context; offer retry and alternate channel; do not lose call outcome |
| Payment uncertain | Never label failed or paid until provider state is known; create reconciliation exception |
| Transfer fails | Return control to original employee and retain transfer packet |
| Offline field event | Queue locally; show unsynced count; idempotent retry |
| Destructive action | Explain consequence, confirm when material, provide undo/archive where practical |
| Automation fails | Attach failure to the affected job/customer and assign an owner; avoid silent global logs |

Current positive evidence includes explicit payment and recording error paths, dialer recovery logic, and reversible blocked callers. Current negative evidence includes raw legacy error text (“Cannot read properties of null...”), missing resource errors, silent best-effort catches, and loading surfaces without visible escalation.

## 12. Prioritized correction roadmap

### Now — integrity and automatic failures

1. **Fix legacy partner normalization** — S1, high frequency across two journeys, low effort. Implemented with regression test.
2. **Identify Academy and partnership missing resources** — S1/S2, medium effort. Capture exact request and repair or remove stale dependency.
3. **Unify Twilio SDK ownership** — S1, high business impact. One loader/version/status/retry path.
4. **Enforce readiness and payment state contracts server-side** — S1, high business impact, medium/high effort.
5. **Define canonical completion; retire or redirect Trigger** — S1, high continuity impact.

### Next — make work effortless

6. **Build exception work queues by role** — S2, very high frequency.
7. **Compose active-call and transfer context packet** — S1/S2, high customer impact.
8. **Consolidate Booked, readiness, schedule and dispatch around one job state** — S1/S2.
9. **Add stable async/loading/error states** across Inbox, detail pages and analytics — S2.
10. **Accessibility tranche:** names, headings, targets, focus, 200% zoom — S2, product-wide.
11. **Virtualize and progressively disclose partnership queue** — S2, large performance/pressure win.

### Then — continuity and learning

12. Structured promises and next-action contract across all records.
13. One channel timeline with job attachment and duplicate prevention.
14. Notification routing/deduplication/acknowledgment.
15. Offline field queue with sync evidence and idempotency tests.
16. Transparent relationship health dimensions and operational learning feedback.
17. Instrument task time, abandonment, retries, duplicate entry, queue age and exception resolution.

## Acceptance gates

No tranche is complete until:

- owner, scoped branch owner, sales, operations, crew and partnership role paths pass;
- desktop, 390px, 320px and 200% zoom pass;
- loading, empty, partial, error, retry and success states pass;
- destructive and monetary transitions have explicit recovery rules;
- the customer/job context survives channel and department transitions;
- a user can state what happened, what matters, who owns it and what happens next.

## Research still required with staff

Production inspection cannot reveal cognition and workarounds. Conduct five 45-minute contextual sessions: sales, dispatcher/operations, crew lead in field, finance/care, partnership manager. Ask each to complete a real task and then ask: **What do you currently keep outside the software because the software does not help you enough?** Record task time, context switches, duplicate entry, misclicks, private notes/sheets, and moments they ask another employee for state.

## Final standard

The software should feel calm because it is carrying state, dependencies, memory and recovery—not because it has fewer pixels. Every page must make the correct action easier than the wrong action and leave the user more organized than it found them.
