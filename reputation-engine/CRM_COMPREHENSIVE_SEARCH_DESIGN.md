# Inbox search: implemented contract and next database read model

## Decision and current implementation

Preserve every existing search path. Contact-field lookup is a separate fast mode; comprehensive search retains the original matcher and complete-directory input. No migration, index, RLS policy or infrastructure setting is changed by this code.

| Behavior | Contacts mode | Comprehensive mode |
|---|---|---|
| Name, company, email, phone, city | Literal case-insensitive server search across the authorized directory | Original combined text matching |
| Industry/category, market labels, stage/status labels | Advanced filters remain available | Original text matching retained |
| Latest inbound/touch notes and formatted message preview | Not part of the contact-field query; the UI explains this | Original matching retained |
| Campaign names and “Batch N” labels | Batch filter available | Original name/label matching retained |
| Market, city aliases, category, trimmed company, batch filters | Database predicates before the page limit; ANDed with authorization | Existing JS predicates unchanged |
| Inbox status/recent-sales tabs | Selecting a queue enters comprehensive mode | Original status and recent-sales membership retained |
| Reports, bulk actions and reporting totals | Never fed paged search rows | Complete directory loader retained |
| Result order | Immutable contact ID, cursor based | Original priority/urgency/recency ordering |

The default reply queue still uses the existing replies endpoint. No full-directory download starts merely by opening the inbox. Typing in Contacts mode starts a debounced search. Comprehensive mode explicitly requests the complete directory and displays an incompleteness notice while it loads. Opening advanced filters also obtains the complete directory so city/category/company/batch options do not silently become a first-page subset. Non-inbox reporting/bulk tabs retain their full loader.

This is an intentional incremental design: comprehensive search is functionally preserved but can still transfer and process a large directory. It is not advertised as a new server-side comprehensive implementation.

## Authorization and query contract

`GET /api/marketing/contacts/search?q=...&limit=50&cursor=...` accepts the same marketing workspace roles as middleware and checks them again inside the route/query builder. Owner and unscoped central manager visibility is unchanged. Scoped managers retain city-market OR assigned-user OR owner-name access. User filters and search predicates are separate AND restrictions; none can replace that scope.

The query selects explicit contact-card columns, requests at most limit+1 rows, and uses `id ASC` / `id > cursorId`. It does not request an exact total or fetch notes/history. Cursors bind the role, branch, user, name, query, filters and page size. Scope is independently rebuilt on every request; cursor contents are never authorization. Invalid/stale cursors return 400 and a restart message.

Normalized city filters use the same market lists and inverse city aliases as the existing inbox. PostgreSQL tests cover La Salle, Chatham, Kitchener/Waterloo including ampersands, Saint Thomas, New Hamburg and Barr Haven. Category filtering retains category-before-industry fallback and exact underscore behavior. Company filtering retains outer-whitespace trimming. Quoted values and literal regular-expression escaping prevent query text from injecting OR conditions or user-controlled regex operators.

Contact closure/status does not implicitly remove an authorized directory record. Comprehensive queues retain the previous closed/active/status filters. Sales-card archive behavior is separate and that experimental endpoint is disabled by default and always disabled in synthetic previews.

## Selection, freshness and pagination

* Search typing, zero results, filters and paging do not automatically switch the active conversation.
* Selecting a card first fetches its full record through the existing authorized detail path. A partial card never reaches an editing/composing workflow.
* A new selection aborts an older pending detail read. The successfully hydrated record is reused when the URL updates, avoiding a duplicate detail request.
* Fresh detail fields take precedence over older reply-list snapshots. Explicit local updates refresh that selected snapshot and invalidate search results; deletion removes it.
* Query/filter changes abort previous reads, clear displayed results immediately and discard late responses using a request generation. Pagination appends unique IDs.
* Returning to the browser tab revalidates the current search. Responses are private/no-store; no shared client search cache is introduced.
* The cursor is a live traversal, not a transaction snapshot. Timestamp edits cannot move a row across ID pages. New/deleted/renamed records may change subsequent pages; a fresh search starts over. A true snapshot requires a database read-model design and is not claimed here.

## Separate proposal: bounded server-side comprehensive search

A later read model should remove the complete-directory dependency without changing the original matcher. This proposal is not an applied schema migration or an enabled endpoint.

Proposed inputs: authenticated server-derived role/market/assignment context, query, exact normalized segment filters, queue/status/recent-sale filter, page size and an opaque cursor bound to all those values. Never accept an arbitrary client user/branch as authorization.

Proposed projection per contact:

1. Identity and contact fields, branch/assignment fields needed for the existing policy, version timestamp and immutable ID.
2. Current inbound/touch snippet and channel/direction needed by the exact preview formatter. Do not scan all historical messages if the original matcher only searched the latest snippets.
3. Canonical city/category, market label, normalized stage and exact derived inbox status.
4. Campaign name and existing batch ordinal. Equal creation timestamps need an explicit compatibility decision; silently choosing a different SQL row-number tie-breaker can change “Batch N” searches.
5. Search text built in the same field order, with the same whitespace and preview formatting as the current `[...].filter(Boolean).join(' ').toLowerCase().includes(q)` expression. OR-ing individual columns is not equivalent for cross-field phrases.

The projection must reproduce the existing reply/directory merge and preview normalization (rich SMS artifacts, outbound prefixes and fallback labels). Build a parity corpus from synthetic fixtures and authorized redacted examples. Compare IDs, order, counts and selected full-record behavior against the existing matcher before enabling a replacement. This includes message-only queries, campaign-only queries, punctuation, empty fields, city aliases, status labels and equal timestamps.

Database filtering, authorization, lifecycle visibility and pagination must run over a single consistent read model. If maintained asynchronously, publish a version/freshness watermark and keep the existing comprehensive fallback until completeness is established. Do not quietly serve a partially backfilled index. The maintenance design must cover contact, latest-touch, batch-name and assignment changes, deletion and concurrent writes; existing financial and provider commands must not be repurposed.

Index candidates depend on the observed plan: primary-key cursor access already exists; a trigram index on an exact comprehensive search expression/read-model text may help substring queries. Confirm extension/index availability, estimated selectivity and write/storage cost before proposing concrete DDL. No index is recommended solely because substring search exists.

## Review and rollout gates

1. Obtain authorized non-executing `EXPLAIN (VERBOSE, COSTS, FORMAT JSON)` plans for representative scoped/unscoped queries. Live execution plans were not available in this assignment; none are invented.
2. Implement and benchmark the proposed model in a disposable/staging database. Preserve the current role and assignment rules and restrict function grants appropriately.
3. Run parity tests over at least 34,137 records, reduced API row caps, concurrent updates/deletes, failures and delayed projection maintenance.
4. Benchmark end-to-end on the same database, server region, browser and representative queries, including p50/p95 only when sample counts justify them. Compare serialized and encoded network bytes, query count, server duration and browser long tasks.
5. Review SQL/index changes separately. Enable a new comprehensive endpoint behind a switch only after equivalence and complete backfill are demonstrated. Keep the current comprehensive mode as rollback.

Rollback for the implemented code-only change is the prior application artifact. A future database proposal needs its own versioned function/index rollback; revert callers before removing a new read model. No timeout increases, financial command changes or automatic production deployment are part of this design.
