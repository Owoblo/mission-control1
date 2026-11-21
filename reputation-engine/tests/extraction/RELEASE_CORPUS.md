# PR-17 capture and release evaluation contract

This is an offline evaluation contract, not authorization to acquire sources. Keep real bodies, labels and permission evidence in owner-approved access-controlled storage. Do not commit real contacts here. No approved real corpus is included in this PR.

## Sampling and review

Target 300–500 permitted captures, sampled before examining candidate outputs. Include realtor/brokerage, property manager, storage, manufacturing, contractor/service, multi-branch and directory/association sources. Include English/French, single/multiple-company, complex/structured HTML, static/rendered HTML and documents. Rendered captures must already exist with approved acquisition evidence; this runner launches no browser. Documents are retained as unsupported by the current replay adapter, not silently converted to HTML or excluded from coverage reporting.

Freeze development and holdout by reviewed registrable-domain group AND template/franchise family AND input business identity. Duplicate source hashes must not cross splits. Transitive shared families form bootstrap clusters. Review template assignments manually: the code cannot discover whether two visually different pages share a hidden vendor template. Never tune on holdout errors and reuse that same holdout as independent release evidence; version a new holdout instead.

Two independent annotators must label raw evidence before seeing candidate outputs. An adjudicator resolves disagreements and records the decisions. Exhaustive labels include valid, invalid and unsupported occurrences, fax/phone, extensions, explicit owner edges, shared and unknown ownership, and entity records. A permission attestation is not automatically proof of lawful collection; owner/legal/source review remains external. Hashes detect changes, not the truth of an attestation.

Proposed gates require >=300 total real captures, >=100 holdout captures, >=50 connected holdout clusters, and >=10 holdout captures for each declared stratum. These are project sampling floors, not a power analysis or universal standard. Require larger denominators where confidence bounds remain too wide. Release thresholds are 99% precision, 90% supported recall, and a diagnostic Wilson precision lower bound >=98% separately for channels and organization/site/person edges. Cluster bootstrap intervals and sampling coverage must receive human review. Passing yields REVIEW_REQUIRED, never deployment authorization.

## Manifest JSON (schema_version 1)

Required top-level fields: `schema_version`, `corpus_kind` (`real` or `synthetic`), `version`, `label_version`, `labels_file`, `labels_sha256`, `captures`.

Each capture has:

- `id`, `url`, `file`, `sha256`, `captured_at` (ISO timestamp); body file <=20 MB, relative to manifest directory.
- `domain_group` (reviewed registrable-domain group), `template_family`, `business_ids` (stable inventory IDs, at least one), `split` (`development`, `holdout`, or separate synthetic `safety`).
- `sector`: `realtor_brokerage`, `property_manager`, `storage`, `manufacturing`, `contractor_service`, `multi_branch`, `directory_association`.
- `language`: `en` or `fr`; `company_scope`: `single` or `multiple`; `source_kind`: `static`, `rendered`, `document`; `markup`: `simple`, `complex`, `structured`. Use a reviewed primary stratum; retain secondary tags in external annotation notes.
- `permission`: `owner_approved: true`, `retention_allowed: true`, `evaluation_allowed: true`, `approved_by`, future `retain_until`, `evidence_file`, `evidence_sha256`. The evidence file records acquisition authorization, method, source restrictions, and retention scope. Revoked approval or expired retention rejects import.

Label JSON is an array, one row per capture: `id`, `label_version`, `exhaustive: true`, `review`, `observations`, `entities`. `review` requires distinct `annotators` (>=2), `independent: true`, `adjudicated: true`, `adjudicator`, `evidence_file`, `evidence_sha256`. Evidence contains original annotations and adjudication, not only a yes/no flag.

An observation has `id`, `channel` (`email`/`phone`), `raw`, exact `locator`, `normalized` (nullable for invalid/unsupported), `status` (`supported`/`invalid`/`unsupported`), `ownership` (`supported`/`shared`/`unknown`), `owners`. Phone rows also require `kind` (`phone`/`fax`/`ambiguous`) and `extension` (string/null). A locator is the original DOM XPath or a precise document pointer, not an inferred business identity. `owners` contain `type` (`organization`/`site`/`person`), stable `id`, optional `business_id` referencing the input inventory, and optional `status: supported`. A shared contact can have multiple supported edges; unresolved candidate owners are not supported edges. Unknown ownership has no supported owner edges.

`entities` contains `record_id` and adjudicated `entity_id`. IDs must represent the same identity consistently across pages. Pair scoring spans capture/record identities: a shared phone does not itself establish an entity merge. Unassigned records are counted separately; missing same-entity links also reduce pair recall.

## Candidate contract and replay limitations

Predictions are a JSON object keyed by capture ID. Every capture must appear, including failed and unsupported ones. Each has `capture_sha256`, `versions`, `observations`, `entities`, optional `diagnostics`. Candidate observations use `status: accepted` instead of gold `supported`; invalid/unsupported remain explicit. Each accepted occurrence needs raw value, locator, method, version, source_url and capture_sha256. Missing evidence reduces provenance completeness; duplicate addresses cannot hide an incomplete occurrence.

Candidate owner edges use `status: asserted` to be scored, or `candidate` to remain unresolved. Do not mark a host relationship asserted merely to improve yield. Entity assignments use the same record IDs as labels, but predicted entity cluster IDs need not equal gold IDs. The scorer compares equality relationships, not the spelling of cluster IDs.

`--replay` invokes current pure extractors. It preserves unprojected structured/context data and diagnostics. It does not invent canonical organization/site entity IDs. Person edges are emitted only where an actual context locator contains the email occurrence; label IDs for this adapter use `person:<locator>:<name>`. Missing safe mappings remain abstentions, which lowers attributable recall. For full regional/CRM entity evaluation, supply independently produced candidate observations with source-scoped stable entity IDs using `--predictions`. That mapping is a release blocker until reviewed; do not use gold labels to build candidate owners.

## Metric definitions

Email/phone recovery is capture-unique normalized value. Phone kind and extension are separate `(value, kind)` and `(value, extension)` set metrics. Normalization is `(locator, raw, status, normalized)`; missing detections reduce normalization recall, so inspect extraction diagnostics before alleging a normalizer defect. Owner metrics are separate `(channel, normalized, owner ID)` sets. Candidate edges against unknown truth are false positives, not omitted from the denominator. Shared and unknown declarations have separate precision/recall. Abstention counts accepted occurrences with no asserted owner edge; this is not automatically an error or correctness claim.

End-to-end yield counts unique correctly extracted, correctly attributed organization/site contacts per unique input business, including businesses with zero results. Person-only edges cannot count without an explicit supported business relation. Pairwise merges/splits span all pages; pair confidence intervals assume dependencies and are diagnostic only. Provenance completeness is occurrence-level, not address-level.

Wilson 95% intervals include numerators/denominators; zero denominators produce null, not 100%. Deterministic clustered bootstrap (400 draws, seed 170017) reports precision/recall/F1 and contacts-per-business intervals using connected domain/template/business groups. Cross-capture entity pair bootstrap is deliberately null: a correct dependent-pair bootstrap is not implemented. Perfect small samples can produce degenerate bootstrap intervals; they do not establish production accuracy.

Errors contain source path/URL/hash, original labels, expected/actual values, observations, versions and diagnostics. Upstream stage stays unknown unless separately investigated; metric discrepancies do not prove a parser/crawler cause. Paired comparisons require identical manifest/label hashes and mark errors new/pre-existing/resolved. Preserve the baseline; do not relabel to hide errors.

## Commands

```sh
python3 -B tests/extraction/run_offline.py --pr PR-17
python3 -B -m scripts.market_map.release_evaluation \
  --manifest /approved/corpus/manifest.json --replay \
  --output "$TMPDIR/pr17-review-new"
python3 -B tests/extraction/run_process_evaluation.py \
  --output "$TMPDIR/pr17-process-new"
```

Output directories must be new children of Python's system temp directory. The evaluation CLI exits 2 for NO_GO, 0 for REVIEW_REQUIRED; neither means release authorization. `--baseline` takes a previous evaluation JSON. `--predictions` replaces replay for a precomputed candidate artifact. `--operations` accepts reviewed status/evidence per operational key (see `OPERATIONS` constant). `--safety-manifest` adds a separate approved synthetic safety corpus; use `--safety-predictions` when not using replay. Source and prediction hashes are recorded. Operational evidence is an attested input, not a cryptographically authenticated CI service; reviewers must verify its logs and applicability to the candidate.

The process runner launches real subprocesses inside macOS `sandbox-exec` with network denied, verifies loopback bind rejection before installing Python audit guards, then exercises concurrent SQLite receipts, deliberate uncommitted-worker death, and locked capture reuse with injected HTTP responses. No live requests occur. Other platforms or denial-profile startup failure are reported unverified with exit 2; there is no thread fallback. This does not test every production worker lifecycle, remote/shared filesystems, or global host coordination.

No production DB migration or configuration change is needed. Roll back evaluation-only additions and the PR-17 test mapping if defective, keep all artifacts and prior failures, and hold release pending a trustworthy rerun. Existing source evidence, schemas, review holds and paused outreach remain unchanged.
