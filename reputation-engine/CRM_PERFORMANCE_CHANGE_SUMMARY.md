> Historical baseline/proposal. The current implementation, preview results and readiness decision are in [CRM_PERFORMANCE_PREVIEW_REVIEW.md](CRM_PERFORMANCE_PREVIEW_REVIEW.md). Pending-search statements below describe the earlier checkpoint, not the current branch. No SQL has been applied.

# Contact search and sales list performance — working draft

Status: **NOT READY FOR DEPLOYMENT. The complete assignment is not finished.**
Measured October 31, 2026 Toronto / November 1 UTC. No production deployment, schema, policy, infrastructure, payment command or Stripe changes were made.

## Production reconciliation

Vercel domain `go.quote2move.com` resolved to deployment `dpl_5ALAAQ6ycm8pq3AhEcpxjzeF9Ntd`, source `48f5ca7d4eeb117acf86d27afdb672971c5dcbbd`, READY. This was checked before application edits. The original working checkout was `2822dc1de56798c3ac1144707412f4489b4b4c74` on `feature/review-completion-workflow`, with substantial existing edits. It was not overwritten or merged into this work.

An isolated clone at `/private/tmp/mission-control-performance-20261101`, branch `fix/contact-search-sales-list-performance`, starts at the production SHA. Fetched `origin/master` was `02c371df5e83ac2aa90919b14bbcde2f19d2f953`, an ancestor of that production commit. The deployment's named source branch was no longer available remotely. No source was inferred from branch names alone.

## Implemented, with activation boundaries

* Sales leads page requests `/api/sales/overview?mode=lead-list`. This projects the already-authorized overview response without altering the shared cache, its normal response, or financial readers. Unused client records and lead/quote fields are omitted. Inventory contents are omitted while retaining the exact inventory-present condition used by existing guidance; only intelligence fields consumed by guidance are retained. Guidance still executes in the browser, preserving its time-zone/date behavior.
* Lifecycle editing opens a freshly fetched full lead, not the display projection. Updates remain existing partial commands. Older overlapping list refreshes cannot overwrite a newer refresh or a completed local mutation. Restore refreshes bypass the overview cache.
* A separate `/api/marketing/contacts/search` API implements contact-field search, lightweight projection, database predicates and immutable-ID cursor pagination. Scope is rebuilt on every request using the same market/assignment rules as the existing route; filters only narrow scope. Literal punctuation is escaped; query size and page size are bounded. Responses are private/no-store. **It is not connected to the inbox yet.**
* `/api/sales/leads?mode=cards` is an **experimental, opt-in** lightweight list. Default GET remains the production implementation. Cards preserve branch inference/identity selection through a lightweight visibility index for scoped managers and exclude archive events before paging. Failures reading lifecycle data fail closed. Each card fetch restricts database IDs/deleted state and rechecks branch visibility. Owner/unscoped reads apply merged/archive exclusions in the database. Optional `pagination=cursor` uses immutable ID order. The experiment is not recommended for activation because full-workflow latency regressed.

## Search behavior decision still pending

The inbox currently matches names, company, email, phone, city, industry, category, campaign names/numbers, normalized stage, market labels, message snippets, formatted preview text and derived status labels. Its city/category filters also normalize aliases. The new API deliberately does not claim equivalence: it searches name/company/email/phone/city and supports exact stored-value filters.

Replacing the old UI with that API would change existing semantics. The pending choice is either to preserve the full contract and prepare a separately reviewed database read function, or explicitly approve contact-field-only search. No dependent UI change has been made. Consequently, the current inbox still loads the full directory, and no browser request reduction is claimed. Reporting/bulk tabs and selection behavior remain untouched.

## Baselines and measurements

Metrics are observed unless marked otherwise. Bytes are uncompressed UTF-8 JSON, not compressed wire bytes. Live reads used authorized credentials without persisting records; only aggregate results are checked in. Network/SQL/server timing is not separately instrumented. Local measurements are not Vercel endpoint timings or p95 estimates.

| Workflow | Before | After / candidate | Interpretation |
|---|---:|---:|---|
| Same live owner overview snapshot, 763 leads / 295 quotes | 13,958,577 B | 9,237,530 B | 4,721,047 B / **33.8% less response JSON**; guidance equal for all 763 leads |
| Overview browser request count | 1 | 1 | No extra list request; shared repository/cache reads unchanged |
| Overview response shaping | — | 9.71 ms | Local CPU time; repository read of that snapshot was 2,370 ms; hosted improvement unmeasured |
| Same 50 lead IDs, direct REST, 3 alternating trials | 1,025,828 B; 102/132/133 ms | 24,982 B; 86/99/110 ms | 97.6% fewer bytes; median 132 → 99 ms for this read only |
| Experimental owner list, including archive checks, 2 trials | 1 request; 162/322 ms; 978,027 B; 49 rows | 3 requests; 843/905 ms; 18,189 B; 50 rows | **Regression; not activated.** Not a correctness-equivalent comparison: legacy filters merged rows after paging and omits archive filtering |
| Early scoped-index candidate used for all roles | 1 request | 6 requests; 1,811–1,991 ms | Rejected for default use; index is now only the opt-in scoped-manager path |
| Contact API, representative query, 2 latest trials | Whole-directory prerequisite | 1 request; 152/158 ms; 18,961 B; first 50 matches | Backend-only measurement; inbox wiring still pending |
| Full contact directory, current count 34,137, page size 500 | 69 pages (calculated) | Not replaced in UI yet | Prior first-500 observation: 1,979,235 B / 435 ms; no full-directory timing invented |

An initial wide JSONB projection was also rejected: 700,570 B for 50 rows, but 285–334 ms versus 113–146 ms for the full record read. Smaller payloads alone do not establish faster workflows.

Raw aggregate measurements: `docs/performance/`. Reproducible overview check: provide authorized `SUPABASE_URL` and `SUPABASE_KEY` in the process environment, then `node scripts/benchmark-sales-list.cjs`. It performs reads and prints aggregate metrics only. Do not paste credentials into shell history or reports.

## Validation

* Production-baseline typecheck passed.
* Production-baseline logic suite: 734 passed / 1 failed out of 735. Existing failure: `partnership-reply-cache-write.test` — “Spam folder coverage could not be verified.” The same failure remained after changes; mailbox code was not changed.
* New integration suites: 10 tests passed. PGlite populated 34,137 synthetic contacts. Tests traverse all 342 pages without duplicates, find a record beyond the old first-page boundary in one search, test market isolation, changed-scope cursor rejection, literal punctuation/injection-like input, invalid bounds and concurrent timestamp updates. Sales tests cover branch movement between index/card reads, deleted predicates, complete lifecycle pagination under a reduced service row cap, archive/restore precedence, fail-closed reads, role isolation, cursor ordering, cache immutability and guidance/sort equivalence.
* Latest typecheck and production build pass, including the release-contract checks (38 deployed route contracts and 23 release dependencies). Preview must build from the reviewed commit.
* Live same-snapshot projection comparison: zero guidance differences across 763 leads. This is a stronger data-dependent check than the synthetic guidance fixture, but does not replace browser/detail editing coverage.
* Browser race test passed in local Chrome: the page requests list mode, a delayed older refresh cannot overwrite newer rows, and no browser errors occurred. Test: `tests/browser/sales-list-performance.mjs`.

## Limitations and remaining work

1. Finish inbox integration after resolving the exact search contract. Do not silently replace derived filters with raw equality or truncate reporting/bulk totals.
2. Complete browser coverage for search debounce/abort, selected full-detail hydration, clearing filters, cursor reset, drafts, out-of-order responses and mutations while a refresh is in flight.
3. Replace the experimental archive/branch visibility work with an efficient database read model only after separate SQL review and safe execution-plan inspection. Do not enable the slower `mode=cards` as the default.
4. Archive visibility is evaluated across separate reads; it is not a transactional snapshot. A concurrent archive after the lifecycle read can appear until the next refresh. UUID/ID cursors prevent reordering from timestamp edits; they do not promise snapshot completeness for concurrent inserts/deletes. Offset pagination retains the existing concurrency limitations.
5. Large archive-ID exclusion URLs need a database-side join/read function before scaling to extensive lifecycle history. Current card mode is experimental, not a long-term design.
6. The shared overview still loads substantial data and retains existing completeness/cache limitations. This change does not fix the global overview read model or the next-step evidence reconstruction system.
7. Verify roles, detail navigation, lifecycle dialogs and current deployment metadata in a protected preview before proposing production promotion.

## Files

`app/api/sales/overview/route.ts`, `app/sales/leads/page.tsx`, `lib/sales-api.ts`: list-only response mode and safe refresh/detail handling.

`lib/sales-list-projection.ts`: display projections, preserving guidance inputs.

`app/api/marketing/contacts/search/route.ts`, `lib/server/contact-search.ts`, `lib/server/list-cursor.ts`: separate bounded search API, scope composition, literal matching and cursor validation.

`app/api/sales/leads/route.ts`, `lib/server/sales-repository.ts`, `lib/server/sales-list-reader.ts`: opt-in experimental cards and read-only visibility helpers. Existing financial/mutation implementations are unchanged.

`tests/integration/contact-search-performance.mjs`, `tests/integration/sales-list-performance.mjs`, `tests/browser/sales-list-performance.mjs`, `scripts/benchmark-sales-list.cjs`: regression coverage and aggregate measurement harness.

## Preview plan — no deployment performed

1. Resolve contact search contract and complete outstanding tests. Recheck production SHA and review intervening changes; do not merge unrelated dirty checkout edits.
2. Run typecheck, new integration/browser suites, full logic suite and final production build. Record the pre-existing mailbox failure separately; investigate before promotion rather than hiding it.
3. Review this branch's complete diff. Keep experimental cards opt-in. No migrations are included in a deployable migration directory.
4. Create a protected Vercel **preview** using a staging Supabase project with representative synthetic data and scoped test users. Disable outbound email/SMS, background automation and real payment credentials through preview configuration. Do not point interactive mutation tests at production.
5. Compare the same owner and scoped-manager workflows, dataset, viewport and network conditions. Capture browser requests, compressed/uncompressed bytes, API durations and request IDs. Verify selected-record edits, navigation, archived records and concurrent changes. Reject any latency/correctness regression.
6. Production promotion requires a separate review. Code rollback is to deploy the previously verified production artifact; no database rollback is needed for the current code-only draft. A proposed SQL function/index, if later approved, needs its own rollback review.
