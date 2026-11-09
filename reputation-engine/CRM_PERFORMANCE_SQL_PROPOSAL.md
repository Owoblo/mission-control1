> Historical baseline/proposal. The current implementation, preview results and readiness decision are in [CRM_PERFORMANCE_PREVIEW_REVIEW.md](CRM_PERFORMANCE_PREVIEW_REVIEW.md). Pending-search statements below describe the earlier checkpoint, not the current branch. No SQL has been applied.

# Read-model proposal — not applied

No schema/index changes are currently required for the separate contact-fields search API. Its sampled first-page reads were 122–158 ms without changing indexes. Do not add five speculative trigram indexes based on that sample alone.

Preserving the complete inbox search contract while moving filtering/pagination into PostgreSQL needs a reviewed read function or searchable read model that reproduces the existing derived market/category/status/campaign/preview logic. The current field-only API is not a substitute for that contract. A concrete SQL implementation is pending the search-contract decision; this document is not an executable migration.

The experimental sales-card path also needs database-side lifecycle resolution to avoid fetching archive history and a branch/identity catalog on every page. Preserve the existing latest archive/restore event ordering, inferred branch rules and manager deduplication. Do not backfill branch values or change authorization policies as a shortcut. Prefer a narrowly granted read function with explicit owner/scoped-manager inputs supplied only by an authenticated backend; grant no direct access to anon/authenticated roles without a separate security review.

Required diagnostics before proposing indexes or activating that function:

1. With authorized read-only SQL access, obtain existing index definitions, actual server/extension versions, relation sizes and bounded non-executing `EXPLAIN (VERBOSE, COSTS, FORMAT JSON)` plans for contact name/email/phone queries, lifecycle-note filtering and card visibility queries.
2. Inspect whether a partial expression index on lifecycle notes for `deleted = false` would improve the observed filter. Check estimated rows and statistics freshness. Do not infer its absence from repository migrations.
3. Evaluate expression/trigram indexes only for demonstrated scans; compare representative short, common and rare search terms, scoped and unscoped users, and later cursor pages. Include index storage/write costs.
4. Implement candidate functions/indexes only on a disposable or staging database and validate against the existing JS semantics, including NULLs, punctuation, city aliases, equal event timestamps, archived/restored records and concurrent changes.

Production execution, if separately approved: capture definitions and grants, check lock/activity state and capacity, create indexes CONCURRENTLY outside transaction blocks where appropriate, apply a versioned function without changing existing callers, validate bounded reads, then enable a reviewed caller. No expensive production EXPLAIN ANALYZE is proposed.

Rollback: switch callers to the prior version first; retain the prior function until rollback is verified. Drop only the newly introduced function/signature and its grants after callers no longer use it. Drop a newly added index CONCURRENTLY only after confirming no other workload depends on it. Never reset statistics, rewrite data or alter RLS as part of this rollback.

Live execution plans were not available in this session. None are invented here. SQL work remains a separate proposal and must not be presented as completed implementation.
