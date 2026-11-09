# CRM contact search and sales list — preview review

## Decision

The inbox integration is implemented on `fix/contact-search-sales-list-performance`. Review it in the protected synthetic preview; **do not promote the synthetic deployment to production**. No production release, schema/index change, RLS change, financial command change or Stripe change has been made.

Contact-field search is now bounded and server-side. Existing comprehensive message/campaign/status matching remains available through the original complete-directory matcher. Its replacement is designed, not implemented. The slower experimental sales cards endpoint is explicitly disabled by default and always disabled in the synthetic preview.

Production readiness is conditional: the targeted regression checks pass, but synthetic hosted timings cannot establish live Supabase query performance. Obtain representative live read-only plans and controlled staging timings before authorizing a production rollout. The full logic suite retains one pre-existing failure, and one legacy benchmark attempt timed out without an established root cause, as described below.

## Source and deployment provenance

Production was reconciled before edits: `go.quote2move.com`, deployment `dpl_5ALAAQ6ycm8pq3AhEcpxjzeF9Ntd`, source `48f5ca7d4eeb117acf86d27afdb672971c5dcbbd`. The user's dirty original checkout on `feature/review-completion-workflow` was preserved. This isolated branch starts from that verified production SHA, not the original checkout's different HEAD.

Working folder: `/private/tmp/mission-control-performance-20261101/reputation-engine`.

Implementation commits: `471a2b4` (sales projection and scoped search), `78c0f4f` (inbox integration, compatibility, preview and tests), `8faf1f1` (preview build telemetry isolation). The production alias was rechecked on November 2 and still points to the same original deployment. Test/documentation-only follow-up commits do not alter deployed application behavior. `b260c58` adds hosted protection checks; later test diagnostics capture failures without request headers.

## What is implemented

- `app/api/marketing/contacts/search/route.ts`, `lib/server/contact-search.ts`, `lib/server/list-cursor.ts`: explicit lightweight projection; bounded limit+1; database search/filter predicates; immutable-ID cursors bound to role, branch, user, query and filters; private/no-store; role checks and rebuilt authorization scope on every page.
- `lib/partnership-inbox-markets.ts`: shared existing market lists and normalization; tested inverse predicates for city aliases, category fallback and company whitespace. Filters narrow the existing market/assignment scope; they cannot replace it.
- `app/components/marketing/contact-search-results.tsx`: 250 ms debounce, request abort and generation guards, cursor paging/deduplication, transient error retry, visibility revalidation, full authorized detail hydration before selection.
- `app/marketing/partners/page.tsx`: integrated Contacts and Comprehensive modes. Inbox opening no longer downloads the whole directory. Comprehensive matching, queue/status behavior and reporting/bulk loaders retain their original complete-directory inputs. Advanced filter options still obtain the complete directory. Search does not change an active conversation or draft. Full detail is fetched once on selection and takes precedence over an older reply snapshot. Local updates/deletions refresh the selected snapshot and invalidate search.
- `app/api/sales/overview/route.ts`, `lib/sales-list-projection.ts`, `lib/sales-api.ts`, `app/sales/leads/page.tsx`: list-only overview projection without altering shared cache contents or normal consumers; full lead hydration before lifecycle editing; newer list refreshes win; restore reads bypass cache. Existing financial commands remain unchanged.
- `app/api/sales/leads/route.ts`: experimental cards require `CRM_EXPERIMENTAL_SALES_CARDS=1`; otherwise return 404. Preview always returns 404. Default sales reads retain their existing implementation.
- Preview isolation in `lib/preview/*`, `app/api/preview/*`, `app/preview/page.tsx`, `middleware.ts`, `next.config.mjs`, instrumentation/Sentry configuration and `vercel.preview.json`.

The complete server-side comprehensive-search proposal is in [CRM_COMPREHENSIVE_SEARCH_DESIGN.md](CRM_COMPREHENSIVE_SEARCH_DESIGN.md). It specifies exact original haystack/preview/campaign-label parity, authorization, freshness and rollout gates. No proposed SQL/index is applied.

## Protection and data isolation

The hosted deployment uses an explicit Vercel **preview** target with platform protection plus application HTTP Basic authentication. It receives fresh synthetic session secrets. Deployment-specific overrides blank inherited provider configuration; no production database credentials are supplied. The role chooser issues only synthetic sessions.

All API reads are routed to deterministic synthetic fixtures. All non-GET/HEAD requests are rejected before the existing handlers, including payment, messaging, webhooks, cron writes and Server Actions. Unknown fixture reads return empty data. Browser CSP limits connections to self; Node fetch fails closed in preview. Runtime safety diagnostics verify the guard and report only matching configuration-key names, never values. Vercel supplies `AWS_REGION` and `AWS_DEFAULT_REGION`; tests allow exactly those non-credential labels and reject any other configured integration key. This is application-level isolation, not a claim that an OS network firewall exists. Sentry runtime/build telemetry and automatic monitor creation are disabled in the final preview build; scheduled jobs are absent.

The fixture contains 34,137 synthetic contacts, two synthetic campaigns and message/campaign-only search targets near the end of the directory. No real customer information or payment data is included. Protection credentials are kept outside Git. The earlier separate preview-project attempt was not deployed because Vercel required its first deployment to be Production; this requirement was not bypassed. The existing project's preview target is used without changing production environment values or protection settings.

## Measurement method and limits

The browser harness compares the legacy eager-directory path (`legacyDirectory=1`, available only in synthetic preview) with the new Contacts path on the same hosted build, data and browser. This is an A/B of the original loader/matcher and the new workflow, not a replay of a separate production deployment. Fresh contexts are used; authentication setup occurs before measured navigation. Query: `Needle Contact 34137`, which is beyond the original first-page boundary.

Input-to-result includes debounce, HTTP, parsing and rendering through two animation frames. Navigation-to-result includes page loading and hydration. API response bytes are decoded JSON; Resource Timing separately records encoded body and transfer sizes. Request counts include all observed page API responses up to result visibility, not just search. Response-end-to-render is a browser completion proxy, not isolated React CPU time. Long tasks are browser tasks over 50 ms during the search window. Cold starts, CDN/browser caching and network variability affect results. Three paired trials are descriptive samples; no p95/p99 is claimed.

**The hosted fixture evaluates the actual query-builder predicates against synthetic data in memory. It does not call live Supabase.** Independent PGlite integration tests execute equivalent PostgreSQL predicates across the same record count. Neither establishes production database query latency, lock behavior, production plans or index adequacy. Do not interpret the measured improvement as an equivalent percentage reduction in live PostgreSQL time.

### Final hosted before/after results

Preview: https://mission-control1-reputation-engine-jtifb5p6h.vercel.app/preview. Deployment `dpl_9M2gXmi7S1eEcEzZ2bEyjkpzFxjX`, application commit `8faf1f1`, target **preview**. Three **completed** paired trials on November 2, 2026 UTC; values are median (min–max). One additional legacy attempt timed out, as recorded immediately below. Trials ran fast then legacy in fresh contexts; this small sample was not randomized.

| Measurement | Legacy directory | Server-side contact workflow |
|---|---:|---:|
| Input → rendered result (ms) | 16,433 (15,676–16,595) | 847 (827–858) |
| Navigation → rendered result (ms) | 17,140 (16,300–17,771) | 2,301 (1,991–2,955) |
| API responses observed | 83 | 14 (13–15) |
| Directory page requests | 69 | 0 |
| Search requests | 0 | 1 |
| Decoded API response bytes | 53,031,545 | 3,342 (3,118–3,394) |
| All browser requests | 112 | 44 |
| All-resource encoded body bytes | 866,925 (866,812–867,764) | 513,184 (513,019–513,243) |
| All-resource transfer bytes | 900,225 (900,112–901,064) | 525,784 (525,319–526,143) |
| Last contact response → rendered result (ms) | 1,672 (1,648–1,697) | 335 (300–352) |
| Search-window long-task time (ms) | 1,628 (1,596–1,645) | 0 |

New search HTTP duration: median **229 ms**, range 212–264 ms (one query request per trial). This includes network and synthetic server processing, not isolated database time.
Input-to-result improved **94.8%** in this synthetic comparison. The three completed pairs had zero uncaught browser errors and passed correctness checks. Raw per-request timings and byte counts: [benchmark evidence](docs/performance/contact-search-preview-20261102.json).

**Additional failed attempt, not hidden in the median:** the second legacy attempt did not reveal the far-end result within 180,000 ms; its fast-search half completed in 830 ms. The pair was retried and passed, and the third pair passed. In that initial series, four fast searches passed and three of four attempted legacy searches completed; this tiny synthetic sample is not a production error-rate estimate. The original failed context closed before diagnostic capture was added, so its client-side cause remains **UNKNOWN**. A bounded review of 500 request records from this preview found no 5xx (414 × 200, 68 × 401 Basic challenges, 6 × 302, 6 × 307, 4 × 405 write-denial checks and 2 × 404 disabled-card checks). Those records do not establish response-body completion or exclude a browser/network interruption. No application fix is claimed for this unexplained legacy failure. The harness now captures safe failure diagnostics for future reproduction.

**Requested confirmation rerun:** passed again after the user requested another attempt. Fast search 883 ms; legacy 15,849 ms; API responses 15 versus 83; decoded API bytes 3,394 versus 53,031,545. Selection, drafts, campaign/message matching, branch isolation and write-denial assertions all passed. The aggregate is now five successful fast searches and four completed legacy searches plus the one unresolved legacy timeout. This extra confirmation is stored in the evidence artifact and is not folded into the three-pair median table above.

Final hosted protection: unauthenticated 302, platform bypass without Basic 401, authenticated 200 with self-only connection CSP, webhook POST 405, fetch guard true. No configured integration credentials were detected; only the platform AWS region labels matched the broad diagnostic key filter. The retried build passed; the earlier transient font-fetch build failure remains documented for reproducibility.


Earlier local development browser result (one final paired run): 9,352 ms legacy versus 892 ms new input-to-result; 84 versus 16 API responses; 53,031,769 versus 3,618 decoded API bytes. Local development timings are secondary and are not hosted production measurements.

Sales payload measurement from the earlier authorized same live snapshot (763 leads, 295 quotes): 13,958,577 → 9,237,530 decoded JSON bytes, **33.8% less**, zero guidance differences across all 763 leads. Projection took 9.71 ms locally; source repository read was 2,370 ms. No hosted before/after sales endpoint latency claim is made. The full overview source read remains expensive. The experimental cards workflow was slower (843–905 ms versus 162–322 ms in the earlier diagnostic), which is why it remains disabled.

## Correctness and test evidence

- TypeScript typecheck: pass. The first final-preview build failed in Next.js Google font fetching (`Cannot read properties of null (reading '1')` in the font loader); a retry is recorded below. This is separate from the targeted tests.
- Targeted integration suites: **15/15 pass**. PostgreSQL-compatible fixture: 34,137 records, 342 cursor pages, no duplicates/omissions; far-record lookup; literal punctuation; role/market/assignment scope; changed-scope cursor rejection; invalid bounds; city aliases; category/brokerage semantics; concurrent timestamp changes. Sales coverage includes guidance/sort parity, cache immutability, lifecycle visibility, row-cap pagination, scope isolation, stale refresh and disabled cards.
- Browser search: far-record lookup; no eager-directory requests in fast mode; cursor load to 100 results; exactly one full-detail request; draft and selection retention; message-only, campaign-name and campaign-label compatibility; branch isolation; blocked writes and cards; no uncaught browser errors in measured workflows.
- Browser concurrency/mobile (passed locally and on the final hosted preview): stale search discarded; transient retry; overlapping detail reads select only the latest choice; fresh detail beats old reply snapshot; tab visibility revalidation; clearing search retains selection; mobile search/detail without horizontal overflow.
- Reporting browser check: Overview still loads all **34,137** contacts independently of paged search results.
- Sales browser (local synthetic API mocks, not a hosted sales latency benchmark): list mode requested; delayed older refresh cannot replace newer rows; no browser errors.
- Full logic suite: **734/735 pass**. One pre-existing failure in `partnership-reply-cache-write.test`: “Spam folder coverage could not be verified.” It also failed before these changes; mailbox code was not modified. This failure remains unresolved, not counted as a passing suite.

Commands: `npm run typecheck`; `node --test tests/integration/contact-search-performance.mjs tests/integration/sales-list-performance.mjs tests/integration/crm-preview-safety.mjs`; `node tests/browser/contact-search-preview.mjs`; `node tests/browser/contact-search-races.mjs`; `node tests/browser/sales-list-performance.mjs`; `npm run test:logic`. Hosted browser commands supply `CRM_PREVIEW_URL` and a private `CRM_PREVIEW_ACCESS_FILE`; no secrets belong in recorded commands or reports.

## Remaining limitations and release gates

1. Comprehensive search, advanced-filter option discovery and reporting still load the full directory. This is deliberate compatibility preservation; their performance has not been solved. The finished design is a separate future implementation, not an enabled read model.
2. Live Supabase end-to-end latency and query plans remain unmeasured for the final integrated workflow. Review safe non-executing EXPLAIN plans and test representative owner/scoped-manager queries on a representative staging database before rollout. Substring regex may scan many records without a suitable index; no new index is assumed or applied.
3. ID cursors protect against timestamp reordering, not arbitrary concurrent inserts, deletes or renamed records. Paging is live, not a transaction snapshot. Revalidation restarts the list; a future snapshot contract needs separate design.
4. Full financial/provider mutation testing is intentionally not run against production or the preview. Existing mutation code is unchanged; preview denies all writes. Synthetic browser coverage does not certify every integration workflow.
5. Sales source overview/cache architecture and the global next-step evidence system remain outside this change. Sales payload reduction does not reduce the underlying database read by the same amount.
6. Address or explicitly accept the recorded baseline mailbox test failure before release. No new targeted assertion regression is known. The unexplained legacy benchmark timeout remains an additional reliability caveat; successful retries do not resolve its cause. This is not an assertion that the entire CRM is regression-free.

## Review, rollout and rollback

1. Review the protected preview using the separate local login file and a Vercel account authorized for the project. Try Owner, Windsor manager and Toronto partnership manager profiles. Verify both search modes and unsent draft retention.
2. Obtain staging plans/timings, confirm scope and alias parity using representative records, and review the documented baseline failure. Apply no proposed index without its own approval, plan and rollback review.
3. Review the diff from verified production SHA. Reconcile any intervening production commits before release. Build a **new production artifact from source** with `CRM_SYNTHETIC_PREVIEW` and `NEXT_PUBLIC_CRM_SYNTHETIC_PREVIEW` unset and experimental cards disabled. Never promote this synthetic preview artifact or reuse its credentials.
4. Production deployment requires a separate explicit instruction. After approval, observe search error rates, authorization failures, p50/p95 API latency, response bytes and page rendering on a controlled rollout. Existing broad timeout diagnosis is not silently added to this assignment.
5. Roll back application changes by redeploying the prior verified production artifact. There are no database/schema changes to reverse. Do not revert unrelated later production work. Disabling/removing preview credentials and deleting temporary previews can be done after review; this report does not require changes to production settings.
